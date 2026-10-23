import { createLocalJWKSet } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { requireUser, verifyIdToken } from './auth';
import { HttpError } from './http';
import {
  claims,
  emulatorEnv,
  signingKey,
  signToken,
  stagingEnv,
  unsignedToken,
} from './test-helpers';

let google: Awaited<ReturnType<typeof signingKey>>;
let attacker: Awaited<ReturnType<typeof signingKey>>;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  google = await signingKey('google-1');
  // Same key ID as Google's, so only the signature tells them apart.
  attacker = await signingKey('google-1');
  keys = createLocalJWKSet({ keys: [google.jwk] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The Auth emulator's account lookup, knowing only the given users.
function mockAuthEmulator(...uids: string[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const { localId } = JSON.parse(String(init?.body)) as { localId: string[] };
    return Response.json(uids.includes(localId[0]) ? { users: [{ localId: localId[0] }] } : {});
  });
}

describe('verifyIdToken', () => {
  it('accepts a token signed by Google for this project', async () => {
    const token = await signToken(google.privateKey, 'google-1', claims());

    await expect(verifyIdToken(token, stagingEnv(), keys)).resolves.toEqual({
      uid: 'ama',
      name: null,
      email: 'ama@example.com',
      emailVerified: true,
    });
  });

  it('includes the display name when the account has one', async () => {
    const token = await signToken(google.privateKey, 'google-1', {
      ...claims(),
      name: 'Ama Mensah',
    });

    await expect(verifyIdToken(token, stagingEnv(), keys)).resolves.toMatchObject({
      name: 'Ama Mensah',
    });
  });

  it('rejects a forged token', async () => {
    const token = await signToken(attacker.privateKey, 'google-1', claims());

    await expect(verifyIdToken(token, stagingEnv(), keys)).rejects.toThrow();
  });

  it('rejects a token for another project', async () => {
    const token = await signToken(google.privateKey, 'google-1', claims('nkabom-prod'));

    await expect(verifyIdToken(token, stagingEnv(), keys)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = await signToken(google.privateKey, 'google-1', {
      ...claims(),
      iat: past,
      exp: past + 3600,
    });

    await expect(verifyIdToken(token, stagingEnv(), keys)).rejects.toThrow();
  });

  it('rejects a token without a user', async () => {
    const token = await signToken(google.privateKey, 'google-1', { ...claims(), sub: '' });

    await expect(verifyIdToken(token, stagingEnv(), keys)).rejects.toThrow();
  });

  it('rejects an unsigned token outside the emulators', async () => {
    await expect(verifyIdToken(unsignedToken(claims()), stagingEnv(), keys)).rejects.toThrow();
  });

  it('rejects an unsigned token when the emulator is set on a real project', async () => {
    const env = stagingEnv({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });

    await expect(verifyIdToken(unsignedToken(claims()), env, keys)).rejects.toThrow();
  });

  it('accepts an unsigned emulator token locally, still checking the project', async () => {
    const lookup = mockAuthEmulator('ama');
    const env = emulatorEnv();

    await expect(
      verifyIdToken(unsignedToken(claims('demo-nkabom')), env, keys),
    ).resolves.toMatchObject({ uid: 'ama' });
    await expect(verifyIdToken(unsignedToken(claims()), env, keys)).rejects.toThrow();
    expect(lookup).toHaveBeenCalledWith(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-nkabom/accounts:lookup',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects an emulator token for a user the emulator does not have', async () => {
    mockAuthEmulator('ama');

    await expect(
      verifyIdToken(unsignedToken(claims('demo-nkabom', 'made-up')), emulatorEnv(), keys),
    ).rejects.toThrow();
  });
});

describe('requireUser', () => {
  it('answers 401 without a bearer token', async () => {
    const request = new Request('https://api.test/v1/me');

    await expect(requireUser(request, stagingEnv(), keys)).rejects.toEqual(
      new HttpError(401, 'Sign in required'),
    );
  });

  it('answers 401 for an invalid token', async () => {
    const request = new Request('https://api.test/v1/me', {
      headers: { Authorization: 'Bearer not-a-token' },
    });

    await expect(requireUser(request, stagingEnv(), keys)).rejects.toMatchObject({ status: 401 });
  });
});
