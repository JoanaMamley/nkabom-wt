import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from './fake-firestore';
import { emulatorEnv, mockEmulators, signedIn } from './test-helpers';
import { requireAccount } from './users';

afterEach(() => {
  vi.restoreAllMocks();
});

function account(uid = 'ama') {
  return requireAccount(
    new Request('https://api.test/v1/me', { headers: signedIn(uid) }),
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

    await expect(account()).resolves.toMatchObject({ role: 'primaryAdmin' });

    expect(firestore.commits).toEqual([]);
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
