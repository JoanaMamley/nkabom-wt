import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { AUDIT_LOG, DIRECTORY, MEMBERS, USERS } from '../worker/src/model';

// Runs against the Firestore emulator: npm run test:rules starts it for the test run.
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-nkabom',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(() => env.cleanup());

// Every test starts from an empty database, so each one creates its collections from scratch.
beforeEach(() => env.clearFirestore());

function as(uid: string) {
  return env.authenticatedContext(uid).firestore();
}

function photoOf(uid: string) {
  return `photos/${uid}/0f8fad5b-d9cb-469f-a165-70867728950e.webp`;
}

function newProfile(overrides: Record<string, unknown> = {}, uid = 'ama') {
  return {
    firstNames: 'Ama Serwaa',
    surname: 'Mensah',
    dateOfBirth: '1998-02-29',
    stage: 'graduate',
    courseOrOccupation: 'Civil engineer',
    graduationYear: 2020,
    photoPath: photoOf(uid),
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
}

describe('users', () => {
  beforeEach(() =>
    seed(`${USERS}/ama`, { role: 'member', email: 'ama@example.com', createdAt: Timestamp.now() }),
  );

  it('lets a user read their own record', async () => {
    await assertSucceeds(getDoc(doc(as('ama'), USERS, 'ama')));
  });

  it("hides other users' records and the list", async () => {
    await assertFails(getDoc(doc(as('kofi'), USERS, 'ama')));
    await assertFails(getDocs(collection(as('ama'), USERS)));
  });

  it('is closed when logged out', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), USERS, 'ama')));
  });

  it('never lets a user write a record, so no one can choose their role', async () => {
    await assertFails(updateDoc(doc(as('ama'), USERS, 'ama'), { role: 'primaryAdmin' }));
    await assertFails(setDoc(doc(as('kofi'), USERS, 'kofi'), { role: 'member', email: null }));
    await assertFails(deleteDoc(doc(as('ama'), USERS, 'ama')));
  });
});

describe('members', () => {
  beforeEach(() => seed(`${MEMBERS}/ama`, { ...newProfile(), createdAt: Timestamp.now() }));

  it('lets a member read their own profile', async () => {
    await assertSucceeds(getDoc(doc(as('ama'), MEMBERS, 'ama')));
  });

  // Registration and edits go through the Worker (NKB-117), which checks every field.
  it('never lets a member create a profile directly, even a valid pending one', async () => {
    await assertFails(setDoc(doc(as('kofi'), MEMBERS, 'kofi'), newProfile({}, 'kofi')));
  });

  it('never lets a member change or delete their profile directly', async () => {
    const profile = doc(as('ama'), MEMBERS, 'ama');

    await assertFails(updateDoc(profile, { surname: 'Owusu' }));
    await assertFails(updateDoc(profile, { status: 'active' }));
    await assertFails(setDoc(profile, newProfile({ surname: 'Owusu' })));
    await assertFails(deleteDoc(profile));
  });

  it("never lets a member write another member's profile", async () => {
    await assertFails(setDoc(doc(as('kofi'), MEMBERS, 'esi'), newProfile({}, 'esi')));
    await assertFails(updateDoc(doc(as('kofi'), MEMBERS, 'ama'), { surname: 'Owusu' }));
  });

  it('is closed when logged out', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, MEMBERS, 'ama')));
    await assertFails(setDoc(doc(db, MEMBERS, 'kofi'), newProfile({}, 'kofi')));
  });

  it("hides other members' profiles and the list", async () => {
    await assertFails(getDoc(doc(as('kofi'), MEMBERS, 'ama')));
    await assertFails(getDocs(collection(as('ama'), MEMBERS)));
  });
});

describe('directory', () => {
  function entry(firstNames: string, graduationYear = 2020) {
    return {
      firstNames,
      surname: 'Mensah',
      photoPath: photoOf(firstNames.toLowerCase()),
      courseOrOccupation: 'Civil engineer',
      graduationYear,
    };
  }

  // Ama and Kofi are active, so the Worker has listed them. Esi is pending: she has a
  // profile but no directory entry.
  beforeEach(async () => {
    await seed(`${DIRECTORY}/ama`, entry('Ama'));
    await seed(`${DIRECTORY}/kofi`, entry('Kofi', 2015));
    for (const [uid, status] of [
      ['ama', 'active'],
      ['kofi', 'active'],
      ['esi', 'pending'],
    ]) {
      await seed(`${MEMBERS}/${uid}`, {
        ...newProfile({ status }, uid),
        createdAt: Timestamp.now(),
      });
    }
  });

  it("lets an active member read another member's directory entry", async () => {
    await assertSucceeds(getDoc(doc(as('ama'), DIRECTORY, 'kofi')));
  });

  it('lets an active member list and filter the directory', async () => {
    await assertSucceeds(getDocs(collection(as('ama'), DIRECTORY)));
    await assertSucceeds(
      getDocs(query(collection(as('ama'), DIRECTORY), where('graduationYear', '==', 2015))),
    );
  });

  it("never lets an active member read another member's full record", async () => {
    await assertFails(getDoc(doc(as('ama'), MEMBERS, 'kofi')));
    await assertFails(getDocs(collection(as('ama'), MEMBERS)));
    await assertFails(
      getDocs(query(collection(as('ama'), MEMBERS), where('status', '==', 'active'))),
    );
  });

  it('hides the directory from a pending member', async () => {
    await assertFails(getDoc(doc(as('esi'), DIRECTORY, 'ama')));
    await assertFails(getDocs(collection(as('esi'), DIRECTORY)));
  });

  it('hides the directory from a signed-in user without a profile', async () => {
    await assertFails(getDocs(collection(as('yaw'), DIRECTORY)));
  });

  it('is closed when logged out', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, DIRECTORY, 'ama')));
    await assertFails(getDocs(collection(db, DIRECTORY)));
  });

  it('cannot be written from the app, so no one can list themselves or add fields', async () => {
    await assertFails(setDoc(doc(as('esi'), DIRECTORY, 'esi'), entry('Esi')));
    await assertFails(updateDoc(doc(as('ama'), DIRECTORY, 'ama'), { dateOfBirth: '1998-02-28' }));
    await assertFails(updateDoc(doc(as('ama'), DIRECTORY, 'kofi'), { surname: 'Owusu' }));
    await assertFails(deleteDoc(doc(as('ama'), DIRECTORY, 'kofi')));
  });
});

describe('auditLog', () => {
  const entry = {
    actor: { uid: 'efua', name: 'Efua Asante', email: 'efua@example.com' },
    action: 'registration.approve',
    target: { type: 'member', id: 'ama' },
    details: null,
  };

  beforeEach(() => seed(`${AUDIT_LOG}/entry1`, { ...entry, at: Timestamp.now() }));

  // Role claims arrive in NKB-208; even a token claiming the top role must not touch the log.
  const primaryAdmin = () => env.authenticatedContext('efua', { role: 'primaryAdmin' }).firestore();

  it('cannot be edited or deleted from the app', async () => {
    const existing = doc(primaryAdmin(), AUDIT_LOG, 'entry1');

    await assertFails(updateDoc(existing, { action: 'member.edit' }));
    await assertFails(setDoc(existing, { ...entry, at: serverTimestamp() }));
    await assertFails(deleteDoc(existing));
  });

  it('cannot be added to from the app', async () => {
    await assertFails(
      setDoc(doc(primaryAdmin(), AUDIT_LOG, 'entry2'), { ...entry, at: serverTimestamp() }),
    );
    await assertFails(
      setDoc(doc(as('ama'), AUDIT_LOG, 'entry2'), { ...entry, at: serverTimestamp() }),
    );
  });

  it('cannot be read from the app yet', async () => {
    await assertFails(getDoc(doc(primaryAdmin(), AUDIT_LOG, 'entry1')));
    await assertFails(getDocs(collection(primaryAdmin(), AUDIT_LOG)));
  });
});

describe('everything else', () => {
  it('is closed by default', async () => {
    await assertFails(setDoc(doc(as('ama'), 'anything', 'ama'), { a: 1 }));
    await assertFails(getDoc(doc(as('ama'), 'anything', 'ama')));
  });
});
