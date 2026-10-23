import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordAudit } from './audit';
import { runTransaction, WriteBatch } from './firestore';
import { emulatorEnv, mockEmulators } from './test-helpers';
import type { Account } from './users';

const admin: Account = {
  uid: 'efua',
  name: 'Efua Asante',
  email: 'efua@example.com',
  emailVerified: true,
  role: 'admin',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordAudit', () => {
  it('records actor, action, target and server time in the audit log', async () => {
    const { firestore } = mockEmulators();

    await runTransaction(emulatorEnv(), async (tx) =>
      recordAudit(
        tx,
        admin,
        'registration.reject',
        { type: 'member', id: 'ama' },
        { reason: 'Not an alumna' },
      ),
    );

    const [[path, entry]] = [...firestore.docs];
    expect(path).toMatch(/^auditLog\/[A-Za-z0-9]{20}$/);
    expect(entry).toEqual({
      actor: { uid: 'efua', name: 'Efua Asante', email: 'efua@example.com' },
      action: 'registration.reject',
      target: { type: 'member', id: 'ama' },
      details: { reason: 'Not an alumna' },
      at: firestore.now,
    });
  });

  it('stores nulls for a missing target, details, name and email', () => {
    const batch = new WriteBatch();

    recordAudit(batch, { ...admin, name: null, email: null }, 'members.export', null);

    expect(batch.writes[0]).toMatchObject({
      op: 'create',
      data: { actor: { uid: 'efua', name: null, email: null }, target: null, details: null },
    });
  });

  it('only ever adds a new entry, under a new ID each time', () => {
    const batch = new WriteBatch();

    recordAudit(batch, admin, 'members.export', null);
    recordAudit(batch, admin, 'members.export', null);

    expect(batch.writes.map(({ op }) => op)).toEqual(['create', 'create']);
    expect(batch.writes[0].path).not.toBe(batch.writes[1].path);
  });

  it('is saved with the change it records, or not at all', async () => {
    const { firestore } = mockEmulators();
    firestore.docs.set('members/ama', { status: 'active' });

    await expect(
      runTransaction(emulatorEnv(), async (tx) => {
        recordAudit(tx, admin, 'member.delete', { type: 'member', id: 'ama' });
        tx.create('members/ama', {});
      }),
    ).rejects.toMatchObject({ status: 'ALREADY_EXISTS' });
    expect([...firestore.docs.keys()]).toEqual(['members/ama']);
  });
});
