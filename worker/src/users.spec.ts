import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from './fake-firestore';
import { emulatorEnv, mockEmulators, signedIn } from './test-helpers';
import { requireAccount } from './users';

afterEach(() => {
  vi.restoreAllMocks();
});

function account(uid = 'ama', extra: Record<string, unknown> = {}) {
  return requireAccount(
    new Request('https://api.test/v1/me', { headers: signedIn(uid, extra) }),
    emulatorEnv(),
  );
}

describe('requireAccount', () => {
  it('creates a member record on a new account’s first call', async () => {
    const { firestore } = mockEmulators();

    await expect(account()).resolves.toMatchObject({ uid: 'ama', role: 'member' });

    expect(firestore.docs.get('users/ama')).toEqual({
      role: 'member',
      email: 'ama@example.com',
      createdAt: firestore.now,
    });
  });

  it('reads the role of an existing record without writing', async () => {
    const { firestore } = mockEmulators();
    firestore.docs.set('users/ama', { role: 'primaryAdmin', email: 'ama@example.com' });

    await expect(account('ama', { role: 'primaryAdmin' })).resolves.toMatchObject({
      role: 'primaryAdmin',
    });

    expect(firestore.dataCommits).toEqual([]);
  });

  it('refuses an expired sign-in with 401, by its role’s limits (NKB-205)', async () => {
    const { firestore } = mockEmulators();
    firestore.docs.set('users/ama', { role: 'admin' });
    firestore.docs.set('users/kofi', { role: 'member' });
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;

    await expect(account('ama', { role: 'admin', auth_time: anHourAgo })).rejects.toMatchObject({
      status: 401,
    });
    await expect(account('kofi', { auth_time: anHourAgo })).resolves.toMatchObject({
      session: { idleSeconds: 30 * 24 * 3600, expiresAt: null },
    });
  });

  describe('role claim', () => {
    // The Auth emulator, answering the claim update as well.
    function mockClaimUpdate(status = 200) {
      const { firestore, fetch } = mockEmulators();
      const emulate = fetch.getMockImplementation()!;
      const updates: unknown[] = [];
      fetch.mockImplementation(async (input, init) => {
        if (String(input).endsWith('accounts:update')) {
          updates.push(JSON.parse(String(init?.body)));
          return Response.json({}, { status });
        }
        return emulate(input, init);
      });
      return { firestore, updates };
    }

    it('is corrected when the token’s claim differs from the record', async () => {
      const { firestore, updates } = mockClaimUpdate();
      firestore.docs.set('users/ama', { role: 'admin' });

      await expect(account('ama', { role: 'member' })).resolves.toMatchObject({ role: 'admin' });
      await account('ama');

      expect(updates).toEqual([
        { localId: 'ama', customAttributes: '{"role":"admin"}' },
        { localId: 'ama', customAttributes: '{"role":"admin"}' },
      ]);
    });

    it('is left alone when it agrees, and a missing claim agrees with member', async () => {
      const { firestore, updates } = mockClaimUpdate();
      firestore.docs.set('users/ama', { role: 'admin' });
      firestore.docs.set('users/kofi', { role: 'member' });

      await account('ama', { role: 'admin' });
      await account('kofi');

      expect(updates).toEqual([]);
    });

    it('does not fail the call when it cannot be updated', async () => {
      const { firestore } = mockClaimUpdate(500);
      firestore.docs.set('users/ama', { role: 'admin' });
      const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(account()).resolves.toMatchObject({ role: 'admin' });

      expect(logError).toHaveBeenCalledWith('Role claim not updated', expect.anything());
    });
  });

  it('stores a null email for accounts without one', async () => {
    const { firestore } = mockEmulators();

    await requireAccount(
      new Request('https://api.test/v1/me', { headers: signedIn('ama', { email: undefined }) }),
      emulatorEnv(),
    );

    expect(firestore.docs.get('users/ama')).toMatchObject({ email: null });
  });

  it('keeps a record written meanwhile, such as an admin’s, and uses its role', async () => {
    const firestore = new FakeFirestore();
    // The admin record (NKB-208) lands between the read and the create.
    const handle = firestore.handle.bind(firestore);
    vi.spyOn(firestore, 'handle').mockImplementation(async (url, init) => {
      if (url.endsWith(':commit')) {
        firestore.docs.set('users/ama', { role: 'admin', email: 'ama@example.com' });
      }
      return handle(url, init);
    });
    mockEmulators(firestore);

    await expect(account()).resolves.toMatchObject({ role: 'admin' });

    expect(firestore.docs.get('users/ama')).toEqual({ role: 'admin', email: 'ama@example.com' });
  });

  it('fails when the record cannot be written', async () => {
    const { fetch } = mockEmulators();
    const emulate = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, init) =>
      String(input).endsWith(':commit')
        ? Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 })
        : emulate(input, init),
    );

    await expect(account()).rejects.toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('refuses a missing sign-in before touching Firestore', async () => {
    const { fetch } = mockEmulators();

    await expect(
      requireAccount(new Request('https://api.test/v1/me'), emulatorEnv()),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
