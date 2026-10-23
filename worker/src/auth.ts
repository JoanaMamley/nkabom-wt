import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import { isDemoProject, type Env } from './env';
import { HttpError } from './http';

// Google's public keys for Firebase ID tokens. jose caches them and refetches when a token names a
// key it does not have, so key rotation needs nothing here.
const GOOGLE_KEYS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  ),
);

export interface User {
  uid: string;
  /** The account's display name, if it has one. */
  name: string | null;
  email: string | null;
  emailVerified: boolean;
}

// Checks the Firebase ID token. Endpoints call it through requireAccount (users.ts).
export async function requireUser(
  request: Request,
  env: Env,
  keys: JWTVerifyGetKey = GOOGLE_KEYS,
): Promise<User> {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');
  if (!match) {
    throw new HttpError(401, 'Sign in required');
  }
  try {
    return await verifyIdToken(match[1], env, keys);
  } catch {
    throw new HttpError(401, 'Invalid or expired sign-in');
  }
}

// The same checks as the Firebase Admin SDK: signed by Google with RS256, issued for this project,
// not expired, and naming a user. The Auth emulator issues unsigned tokens, accepted only locally,
// and then only for a user the emulator has, so a made-up token is still refused.
export async function verifyIdToken(
  token: string,
  env: Env,
  keys: JWTVerifyGetKey = GOOGLE_KEYS,
): Promise<User> {
  const projectId = env.FIREBASE_PROJECT_ID;
  let payload: JWTPayload;
  if (env.FIREBASE_AUTH_EMULATOR_HOST && isDemoProject(env)) {
    payload = decodeJwt(token);
    checkClaims(payload, projectId);
    await requireEmulatorUser(env.FIREBASE_AUTH_EMULATOR_HOST, projectId, payload.sub as string);
  } else {
    ({ payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    }));
    checkClaims(payload, projectId);
  }
  return {
    uid: payload.sub as string,
    name: typeof payload['name'] === 'string' ? payload['name'] : null,
    email: typeof payload['email'] === 'string' ? payload['email'] : null,
    emailVerified: payload['email_verified'] === true,
  };
}

async function requireEmulatorUser(host: string, projectId: string, uid: string): Promise<void> {
  const response = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: [uid] }),
    },
  );
  const { users } = (await response.json()) as { users?: unknown[] };
  if (!response.ok || !users?.length) {
    throw new Error('No such user in the Auth emulator');
  }
}

// jwtVerify already checks some of these; repeating them covers the emulator path too.
function checkClaims(payload: JWTPayload, projectId: string): void {
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `https://securetoken.google.com/${projectId}` || payload.aud !== projectId) {
    throw new Error('Token is for another project');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Token has expired');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '' || payload.sub.length > 128) {
    throw new Error('Token has no user');
  }
  const authTime = payload['auth_time'];
  if (typeof authTime !== 'number' || authTime > now + 60) {
    throw new Error('Token has no valid sign-in time');
  }
}
