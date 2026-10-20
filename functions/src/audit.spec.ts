import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, collection } = vi.hoisted(() => {
  const create = vi.fn();
  return { create, collection: vi.fn(() => ({ doc: () => ({ create }) })) };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

import { type Caller, recordAudit } from './audit';

const admin = {
  uid: 'efua',
  token: { name: 'Efua Asante', email: 'efua@example.com' },
} as Caller;

describe('recordAudit', () => {
  beforeEach(() => {
    create.mockReset();
    collection.mockClear();
  });

  it('records actor, action, target and server time in the audit log', async () => {
    await recordAudit(
      admin,
      'registration.reject',
      { type: 'member', id: 'ama' },
      { reason: 'Not an alumna' },
    );

    expect(collection).toHaveBeenCalledWith('auditLog');
    expect(create).toHaveBeenCalledWith({
      actor: { uid: 'efua', name: 'Efua Asante', email: 'efua@example.com' },
      action: 'registration.reject',
      target: { type: 'member', id: 'ama' },
      details: { reason: 'Not an alumna' },
      at: 'SERVER_TIMESTAMP',
    });
  });

  it('stores nulls for a missing target, details, name and email', async () => {
    await recordAudit({ uid: 'efua', token: {} } as Caller, 'members.export', null);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { uid: 'efua', name: null, email: null },
        target: null,
        details: null,
      }),
    );
  });

  it('refuses an action without a signed-in actor', async () => {
    await expect(recordAudit(undefined, 'members.export', null)).rejects.toThrow(
      'no signed-in actor',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('fails when the entry cannot be written, so the caller does not carry on unlogged', async () => {
    create.mockRejectedValue(new Error('unavailable'));

    await expect(recordAudit(admin, 'member.edit', { type: 'member', id: 'ama' })).rejects.toThrow(
      'unavailable',
    );
  });
});
