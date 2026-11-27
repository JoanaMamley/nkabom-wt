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

// The Auth emulator, answering account updates (a role claim, or an address marked verified) too.
function mockAuthUpdates(status = 200) {
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
    it('is corrected when the token’s claim differs from the record', async () => {
      const { firestore, updates } = mockAuthUpdates();
      firestore.docs.set('users/ama', { role: 'admin' });

      await expect(account('ama', { role: 'member' })).resolves.toMatchObject({ role: 'admin' });
      await account('ama');

      expect(updates).toEqual([
        { localId: 'ama', customAttributes: '{"role":"admin"}' },
        { localId: 'ama', customAttributes: '{"role":"admin"}' },
      ]);
    });

    it('is left alone when it agrees, and a missing claim agrees with member', async () => {
      const { firestore, updates } = mockAuthUpdates();
      firestore.docs.set('users/ama', { role: 'admin' });
      firestore.docs.set('users/kofi', { role: 'member' });

      await account('ama', { role: 'admin' });
      await account('kofi');

      expect(updates).toEqual([]);
    });

    it('does not fail the call when it cannot be updated', async () => {
      const { firestore } = mockAuthUpdates(500);
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

  describe('an unverified address', () => {
    const unverified = (provider: string, extra: Record<string, unknown> = {}) => ({
      email_verified: false,
      firebase: { sign_in_provider: provider, identities: {} },
      ...extra,
    });

    it('is refused for an email and password account (FR-1.2)', async () => {
      const { firestore, updates } = mockAuthUpdates();

      await expect(account('ama', unverified('password'))).rejects.toMatchObject({
        status: 403,
        message: 'Verify your email address first',
      });
      expect(updates).toEqual([]);
      expect(firestore.docs.has('users/ama')).toBe(false);
    });

    it('is counted as verified for a Facebook account, and marked so in Firebase (NKB-211)', async () => {
      const { firestore, updates } = mockAuthUpdates();

      await expect(account('ama', unverified('facebook.com'))).resolves.toMatchObject({
        role: 'member',
      });
      expect(updates).toEqual([{ localId: 'ama', emailVerified: true }]);
      expect(firestore.docs.get('users/ama')).toMatchObject({ email: 'ama@example.com' });
    });

    it('is not trusted from any other provider', async () => {
      const { updates } = mockAuthUpdates();

      await expect(account('ama', unverified('google.com'))).rejects.toMatchObject({
        status: 403,
      });
      expect(updates).toEqual([]);
    });

    it('is refused for a Facebook account with no address', async () => {
      const { firestore, updates } = mockAuthUpdates();

      await expect(
        account('ama', unverified('facebook.com', { email: undefined })),
      ).rejects.toMatchObject({
        status: 403,
        message:
          'Your Facebook account has no email address. Sign up with your email address instead.',
      });
      expect(updates).toEqual([]);
      expect(firestore.docs.has('users/ama')).toBe(false);
    });

    it('is refused, to try again, when Firebase cannot mark it verified', async () => {
      const { firestore } = mockAuthUpdates(503);
      const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(account('ama', unverified('facebook.com'))).rejects.toMatchObject({
        status: 502,
        message: 'Your Facebook login could not be finished. Please try again.',
      });
      expect(logError).toHaveBeenCalledWith(
        'Facebook address not marked verified',
        expect.anything(),
      );
      expect(firestore.docs.has('users/ama')).toBe(false);
    });
  });

  it('refuses an admin who logs in with Facebook (FR-1.9)', async () => {
    const { firestore } = mockAuthUpdates();
    firestore.docs.set('users/ama', { role: 'admin', email: 'ama@example.com' });

    await expect(
      account('ama', {
        role: 'admin',
        firebase: { sign_in_provider: 'facebook.com', identities: {} },
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Admins log in with email and password' });
  });

  it('refuses a missing sign-in before touching Firestore', async () => {
    const { fetch } = mockEmulators();

    await expect(
      requireAccount(new Request('https://api.test/v1/me'), emulatorEnv()),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
