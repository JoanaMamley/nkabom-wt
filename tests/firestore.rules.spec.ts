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
  MAX_YEARS_TO_GRADUATION,
  MEMBERS,
  MIN_GRADUATION_YEAR,
  STAGES,
  USERS,
} from '../functions/src/model';

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
  it('lets a user create their own pending profile and read it back', async () => {
    const profile = doc(as('ama'), MEMBERS, 'ama');

    await assertSucceeds(setDoc(profile, newProfile()));
    await assertSucceeds(getDoc(profile));
  });

  it('accepts both stages', async () => {
    for (const [i, stage] of STAGES.entries()) {
      await assertSucceeds(
        setDoc(doc(as(`user${i}`), MEMBERS, `user${i}`), newProfile({ stage }, `user${i}`)),
      );
    }
  });

  it('allows only one profile per user', async () => {
    const profile = doc(as('ama'), MEMBERS, 'ama');
    await setDoc(profile, newProfile());

    await assertFails(setDoc(profile, newProfile({ surname: 'Owusu' })));
    await assertFails(updateDoc(profile, { surname: 'Owusu' }));
    await assertFails(deleteDoc(profile));
  });

  it("refuses a profile under another user's ID", async () => {
    await assertFails(setDoc(doc(as('kofi'), MEMBERS, 'ama'), newProfile()));
  });

  it('refuses a profile when logged out', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, MEMBERS, 'ama'), newProfile()));
  });

  it("hides other members' profiles and the list", async () => {
    await seed(`${MEMBERS}/ama`, { ...newProfile(), createdAt: Timestamp.now() });

    await assertFails(getDoc(doc(as('kofi'), MEMBERS, 'ama')));
    await assertFails(getDocs(collection(as('ama'), MEMBERS)));
  });

  it('refuses any status but pending, so members cannot approve themselves', async () => {
    for (const status of ['active', 'rejected', 'deactivated']) {
      await assertFails(setDoc(doc(as('ama'), MEMBERS, 'ama'), newProfile({ status })));
    }
  });

  it('refuses missing and extra fields', async () => {
    const withoutPhoto: Record<string, unknown> = newProfile();
    delete withoutPhoto['photoPath'];

    await assertFails(setDoc(doc(as('ama'), MEMBERS, 'ama'), withoutPhoto));
    await assertFails(setDoc(doc(as('ama'), MEMBERS, 'ama'), newProfile({ role: 'admin' })));
  });

  it.each([
    ['a blank first name', { firstNames: '  ' }],
    ['a surname over 100 characters', { surname: 'a'.repeat(101) }],
    ['a date of birth in another format', { dateOfBirth: '29/02/1998' }],
    ['month 13', { dateOfBirth: '1998-13-01' }],
    ['day 32', { dateOfBirth: '1998-01-32' }],
    ['an unknown stage', { stage: 'retired' }],
    ['a blank course or occupation', { courseOrOccupation: '' }],
    ['a graduation year before the range', { graduationYear: MIN_GRADUATION_YEAR - 1 }],
    [
      'a graduation year after the range',
      { graduationYear: new Date().getFullYear() + MAX_YEARS_TO_GRADUATION + 1 },
    ],
    ['a fractional graduation year', { graduationYear: 2020.5 }],
    ['a graduation year as text', { graduationYear: '2020' }],
    ['a blank photo path', { photoPath: '' }],
    ["another member's photo", { photoPath: photoOf('kofi') }],
    ['a photo name not issued by the upload function', { photoPath: 'photos/ama/profile.webp' }],
    ['a photo path with a prefix', { photoPath: `x/${photoOf('ama')}` }],
    ['a photo of another type', { photoPath: photoOf('ama').replace('.webp', '.svg') }],
    ['a photo URL', { photoPath: `https://example.com/${photoOf('ama')}` }],
    ['a creation time set by the client', { createdAt: Timestamp.fromDate(new Date(2020, 0, 1)) }],
    ['an update time set by the client', { updatedAt: Timestamp.fromDate(new Date(2020, 0, 1)) }],
  ])('refuses %s', async (_case, overrides) => {
    await assertFails(setDoc(doc(as('ama'), MEMBERS, 'ama'), newProfile(overrides)));
  });

  it('accepts each photo type', async () => {
    for (const [i, ext] of ['jpg', 'png', 'webp'].entries()) {
      const uid = `user${i}`;
      const photoPath = photoOf(uid).replace('.webp', `.${ext}`);
      await assertSucceeds(setDoc(doc(as(uid), MEMBERS, uid), newProfile({ photoPath }, uid)));
    }
  });

  it('accepts the ends of the graduation year range', async () => {
    const last = new Date().getFullYear() + MAX_YEARS_TO_GRADUATION;

    await assertSucceeds(
      setDoc(doc(as('ama'), MEMBERS, 'ama'), newProfile({ graduationYear: MIN_GRADUATION_YEAR })),
    );
    await assertSucceeds(
      setDoc(doc(as('kofi'), MEMBERS, 'kofi'), newProfile({ graduationYear: last }, 'kofi')),
    );
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

  // Ama and Kofi are active, so the sync function has listed them. Esi is pending: she has a
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
