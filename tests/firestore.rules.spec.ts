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

import {
  AUDIT_LOG,
  DIRECTORY,
  EMAIL_VERIFICATIONS,
  JOB_STATUS,
  MEMBERS,
  PASSWORD_RESETS,
  USERS,
} from '../worker/src/model';

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

// A signed-in user whose email address is verified, as every account must be (NKB-202).
function as(uid: string, claims: Record<string, unknown> = {}) {
  return env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore();
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

// Admin access (NKB-204, FR-1.11): the role claim and the users record must agree.
describe('role-based access', () => {
  const roles = ['admin', 'primaryAdmin'];

  beforeEach(async () => {
    await seed(`${USERS}/ama`, { role: 'member', email: 'ama@example.com' });
    await seed(`${USERS}/efua`, { role: 'admin', email: 'efua@example.com' });
    await seed(`${USERS}/kojo`, { role: 'primaryAdmin', email: 'kojo@example.com' });
    await seed(`${MEMBERS}/ama`, { ...newProfile(), createdAt: Timestamp.now() });
    await seed(`${DIRECTORY}/kofi`, { firstNames: 'Kofi', surname: 'Owusu' });
  });

  it.each(roles)('lets a %s read any user, member and directory entry', async (role) => {
    const uid = role === 'admin' ? 'efua' : 'kojo';
    const db = as(uid, { role });

    await assertSucceeds(getDoc(doc(db, USERS, 'ama')));
    await assertSucceeds(getDocs(collection(db, USERS)));
    await assertSucceeds(getDoc(doc(db, MEMBERS, 'ama')));
    await assertSucceeds(getDocs(collection(db, MEMBERS)));
    await assertSucceeds(getDoc(doc(db, DIRECTORY, 'kofi')));
  });

  it('denies a member every admin read, even one claiming an admin role', async () => {
    for (const db of [as('ama'), as('ama', { role: 'member' }), as('ama', { role: 'admin' })]) {
      await assertFails(getDoc(doc(db, USERS, 'efua')));
      await assertFails(getDocs(collection(db, USERS)));
      await assertFails(getDoc(doc(db, MEMBERS, 'kofi')));
      await assertFails(getDocs(collection(db, MEMBERS)));
      await assertFails(getDoc(doc(db, DIRECTORY, 'kofi')));
    }
  });

  it('denies an admin whose users record no longer says admin, whatever the token claims', async () => {
    await seed(`${USERS}/efua`, { role: 'member', email: 'efua@example.com' });

    await assertFails(getDoc(doc(as('efua', { role: 'admin' }), MEMBERS, 'ama')));
    await assertFails(getDoc(doc(as('efua', { role: 'primaryAdmin' }), USERS, 'ama')));
  });

  it('denies an admin record without the claim, or with an unverified email', async () => {
    await assertFails(getDoc(doc(as('efua'), MEMBERS, 'ama')));
    const unverified = env
      .authenticatedContext('efua', { email_verified: false, role: 'admin' })
      .firestore();
    await assertFails(getDoc(doc(unverified, MEMBERS, 'ama')));
  });

  it.each(roles)('lets a %s write nothing from the app', async (role) => {
    const db = as('efua', { role });

    await assertFails(updateDoc(doc(db, USERS, 'ama'), { role: 'primaryAdmin' }));
    await assertFails(setDoc(doc(db, USERS, 'new'), { role: 'admin', email: null }));
    await assertFails(deleteDoc(doc(db, USERS, 'ama')));
    await assertFails(updateDoc(doc(db, MEMBERS, 'ama'), { status: 'active' }));
    await assertFails(deleteDoc(doc(db, MEMBERS, 'ama')));
    await assertFails(setDoc(doc(db, DIRECTORY, 'efua'), { firstNames: 'Efua' }));
    await assertFails(setDoc(doc(db, 'anythingElse', 'x'), { a: 1 }));
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

  // Even a Primary Admin cannot touch the log from the app.
  const primaryAdmin = () => as('efua', { role: 'primaryAdmin' });

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

describe('jobStatus', () => {
  beforeEach(() =>
    seed(`${JOB_STATUS}/daily-sample`, { task: 'sample', status: 'failed', attempt: 4 }),
  );

  it('cannot be read or written from the app, even by a Primary Admin', async () => {
    const primaryAdmin = as('efua', { role: 'primaryAdmin' });

    await assertFails(getDoc(doc(primaryAdmin, JOB_STATUS, 'daily-sample')));
    await assertFails(updateDoc(doc(primaryAdmin, JOB_STATUS, 'daily-sample'), { status: 'ok' }));
    await assertFails(setDoc(doc(as('ama'), JOB_STATUS, 'frequent-sample'), { status: 'ok' }));
  });
});

// The email counts the Worker keeps to limit resends (NKB-202, NKB-203).
for (const collection of [EMAIL_VERIFICATIONS, PASSWORD_RESETS]) {
  describe(collection, () => {
    beforeEach(() => seed(`${collection}/ama`, { lastSentAt: 0, day: '2026-10-31', count: 1 }));

    it('cannot be read or written from the app, even by its own account', async () => {
      await assertFails(getDoc(doc(as('ama'), collection, 'ama')));
      await assertFails(updateDoc(doc(as('ama'), collection, 'ama'), { count: 0 }));
    });
  });
}

describe('an account whose email address is not verified', () => {
  // Ama is active and listed, but has signed in with an unverified address.
  beforeEach(async () => {
    await seed(`${USERS}/ama`, { role: 'member', email: 'ama@example.com' });
    await seed(`${MEMBERS}/ama`, {
      ...newProfile({ status: 'active' }),
      createdAt: Timestamp.now(),
    });
    await seed(`${DIRECTORY}/ama`, { firstNames: 'Ama', surname: 'Mensah' });
  });

  it('cannot read anything, not even its own records (FR-1.2)', async () => {
    for (const claims of [{ email_verified: false }, { email_verified: undefined }]) {
      const db = as('ama', claims);
      await assertFails(getDoc(doc(db, USERS, 'ama')));
      await assertFails(getDoc(doc(db, MEMBERS, 'ama')));
      await assertFails(getDoc(doc(db, DIRECTORY, 'ama')));
      await assertFails(getDocs(collection(db, DIRECTORY)));
    }
  });
});

describe('everything else', () => {
  it('is closed by default', async () => {
    await assertFails(setDoc(doc(as('ama'), 'anything', 'ama'), { a: 1 }));
    await assertFails(getDoc(doc(as('ama'), 'anything', 'ama')));
  });
});
