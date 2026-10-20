import type { UserRecord } from 'firebase-admin/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, doc } = vi.hoisted(() => {
  const create = vi.fn();
  return { create, doc: vi.fn(() => ({ create })) };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc }) }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

import { createUserRecord } from './users';

const user = { uid: 'ama', email: 'ama@example.com' } as UserRecord;

describe('createUserRecord', () => {
  beforeEach(() => {
    create.mockReset();
    doc.mockClear();
  });

  it('creates a member record keyed by the user ID', async () => {
    await createUserRecord.run(user, {});

    expect(doc).toHaveBeenCalledWith('ama');
    expect(create).toHaveBeenCalledWith({
      role: 'member',
      email: 'ama@example.com',
      createdAt: 'SERVER_TIMESTAMP',
    });
  });

  it('stores a null email for accounts without one', async () => {
    await createUserRecord.run({ uid: 'ama' } as UserRecord, {});

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });

  it('leaves an existing record, such as an admin, unchanged', async () => {
    create.mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }));

    await expect(createUserRecord.run(user, {})).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    create.mockRejectedValue(new Error('unavailable'));

    await expect(createUserRecord.run(user, {})).rejects.toThrow('unavailable');
  });
});
