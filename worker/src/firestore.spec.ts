import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from './fake-firestore';
import {
  commit,
  decodeFields,
  encodeFields,
  FirestoreError,
  runTransaction,
  SERVER_TIME,
  WriteBatch,
} from './firestore';
import { emulatorEnv, mockEmulators } from './test-helpers';

const env = emulatorEnv();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decodeFields', () => {
  it('turns Firestore values into plain values', () => {
    expect(
      decodeFields({
        role: { stringValue: 'member' },
        active: { booleanValue: true },
        year: { integerValue: '2019' },
        score: { doubleValue: 4.5 },
        removed: { nullValue: null },
        createdAt: { timestampValue: '2026-10-23T08:00:00Z' },
        courses: { arrayValue: { values: [{ stringValue: 'Nursing' }] } },
        none: { arrayValue: {} },
        address: { mapValue: { fields: { city: { stringValue: 'Accra' } } } },
      }),
    ).toEqual({
      role: 'member',
      active: true,
      year: 2019,
      score: 4.5,
      removed: null,
      createdAt: new Date('2026-10-23T08:00:00Z'),
      courses: ['Nursing'],
      none: [],
      address: { city: 'Accra' },
    });
  });
});

describe('encodeFields', () => {
  const values = {
    role: 'member',
    active: true,
    year: 2019,
    score: 4.5,
    removed: null,
    createdAt: new Date('2026-10-23T08:00:00Z'),
    courses: ['Nursing'],
    address: { city: 'Accra' },
  };

  it('stores whole numbers as integers, so the rules see an int', () => {
    expect(encodeFields({ year: 2019, score: 4.5 })).toEqual({
      year: { integerValue: '2019' },
      score: { doubleValue: 4.5 },
    });
  });

  it('is undone by decodeFields', () => {
    expect(decodeFields(encodeFields(values))).toEqual(values);
  });

  it('refuses values Firestore cannot hold', () => {
    expect(() => encodeFields({ missing: undefined })).toThrow('cannot store a undefined');
  });
});

describe('commit', () => {
  it('creates, sets, updates and deletes, with server times', async () => {
    const { firestore } = mockEmulators();
    firestore.docs.set('members/ama', { surname: 'Mensah', stage: 'student' });
    firestore.docs.set('directory/kofi', { surname: 'Owusu' });

    const batch = new WriteBatch();
    batch.create('users/ama', { role: 'member', createdAt: SERVER_TIME });
    batch.set('directory/ama', { surname: 'Mensah' });
    batch.update('members/ama', { stage: 'graduate', updatedAt: SERVER_TIME });
    batch.delete('directory/kofi');
    await commit(env, batch);

    expect(Object.fromEntries(firestore.docs)).toEqual({
      'users/ama': { role: 'member', createdAt: firestore.now },
      'directory/ama': { surname: 'Mensah' },
      'members/ama': { surname: 'Mensah', stage: 'graduate', updatedAt: firestore.now },
    });
  });

  it('applies nothing when one write fails, and names the reason', async () => {
    const { firestore } = mockEmulators();
    firestore.docs.set('users/ama', { role: 'admin' });

    const batch = new WriteBatch();
    batch.set('directory/ama', { surname: 'Mensah' });
    batch.create('users/ama', { role: 'member' });

    await expect(commit(env, batch)).rejects.toMatchObject({ status: 'ALREADY_EXISTS' });
    expect([...firestore.docs.keys()]).toEqual(['users/ama']);
  });

  it('refuses an update to a missing document', async () => {
    mockEmulators();
    const batch = new WriteBatch();
    batch.update('members/ama', { stage: 'graduate' });

    await expect(commit(env, batch)).rejects.toMatchObject({ status: 'NOT_FOUND' });
  });
});

describe('runTransaction', () => {
  it('reads in the transaction and commits its writes', async () => {
    const { firestore } = mockEmulators();
    firestore.docs.set('members/ama', { surname: 'Mensah' });

    const result = await runTransaction(env, async (tx) => {
      const [ama, kofi] = await tx.getAll('members/ama', 'members/kofi');
      tx.set('directory/ama', { surname: ama?.['surname'] });
      return kofi;
    });

    expect(result).toBeNull();
    expect(firestore.docs.get('directory/ama')).toEqual({ surname: 'Mensah' });
    expect(firestore.openTransactions).toBe(0);
  });

  it('runs again when Firestore aborts the commit', async () => {
    const { firestore } = mockEmulators();
    firestore.abortCommits = 2;
    const update = vi.fn(async (tx: WriteBatch) => tx.set('directory/ama', { surname: 'Mensah' }));

    await runTransaction(env, update);

    expect(update).toHaveBeenCalledTimes(3);
    expect(firestore.commits).toHaveLength(1);
  });

  it('gives up after five aborts', async () => {
    const { firestore } = mockEmulators();
    firestore.abortCommits = 5;

    await expect(runTransaction(env, async () => undefined)).rejects.toBeInstanceOf(FirestoreError);
    expect(firestore.commits).toHaveLength(0);
  });

  it('rolls back and writes nothing when the update throws', async () => {
    const { firestore } = mockEmulators();

    await expect(
      runTransaction(env, async (tx) => {
        tx.set('directory/ama', { surname: 'Mensah' });
        throw new Error('not allowed');
      }),
    ).rejects.toThrow('not allowed');
    expect(firestore.docs.size).toBe(0);
    expect(firestore.openTransactions).toBe(0);
  });

  it('does not run again for other failures', async () => {
    const { firestore } = mockEmulators(new FakeFirestore());
    firestore.docs.set('users/ama', { role: 'admin' });
    const update = vi.fn(async (tx: WriteBatch) => tx.create('users/ama', { role: 'member' }));

    await expect(runTransaction(env, update)).rejects.toMatchObject({ status: 'ALREADY_EXISTS' });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
