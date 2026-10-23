import { base64url, exportJWK, exportPKCS8, generateKeyPair, SignJWT, type JWK } from 'jose';
import { vi } from 'vitest';

import type { Env } from './env';
import { FakeFirestore } from './fake-firestore';

export const PROJECT_ID = 'nkabom-staging';

export function stagingEnv(overrides: Partial<Env> = {}): Env {
  return {
    FIREBASE_PROJECT_ID: PROJECT_ID,
    ALLOWED_ORIGINS: 'https://nkabom-staging.web.app,https://nkabom-staging.firebaseapp.com',
    APP_URL: 'https://nkabom-staging.web.app',
    PHOTOS: {} as KVNamespace,
    BACKUPS: {} as KVNamespace,
    ...overrides,
  };
}

export function emulatorEnv(overrides: Partial<Env> = {}): Env {
  return stagingEnv({
    FIREBASE_PROJECT_ID: 'demo-nkabom',
    ALLOWED_ORIGINS: 'http://localhost:4200',
    APP_URL: 'http://localhost:4200',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    ...overrides,
  });
}

// An RSA key standing in for Google's token signing key (or, for forged tokens, an attacker's).
export async function signingKey(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { privateKey, jwk, pkcs8: await exportPKCS8(privateKey) };
}

export function claims(projectId = PROJECT_ID, uid = 'ama') {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    email: 'ama@example.com',
    email_verified: true,
  };
}

export function signToken(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid }).sign(privateKey);
}

// The Auth emulator's tokens are unsigned: alg "none" and an empty signature.
export function unsignedToken(payload: Record<string, unknown>) {
  const part = (value: unknown) => base64url.encode(JSON.stringify(value));
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(payload)}.`;
}

// Stands in for the Auth and Firestore emulators: Auth knows every user, and Firestore is the
// given fake.
export function mockEmulators(firestore = new FakeFirestore()) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('accounts:lookup')) {
      const { localId } = JSON.parse(String(init?.body)) as { localId: string[] };
      return Response.json({ users: [{ localId: localId[0] }] });
    }
    if (firestore.handles(url)) {
      return firestore.handle(url, init);
    }
    return new Response('unexpected request', { status: 500 });
  });
  return { firestore, fetch };
}

// A signed-in request's headers for the emulator project.
export function signedIn(uid = 'ama', extra: Record<string, unknown> = {}) {
  return {
    Authorization: `Bearer ${unsignedToken({ ...claims('demo-nkabom', uid), ...extra })}`,
  };
}
