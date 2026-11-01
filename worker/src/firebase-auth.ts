import { isDemoProject, type Env } from './env';
import { getAccessToken } from './google';

// Firebase Auth's REST API (Identity Toolkit v1), as the service account. Like Firestore, the
// emulator takes "owner" as a token with admin rights.

/** A Firebase Auth account, as far as the Worker needs it. */
export interface AuthAccount {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

/** The account with this user ID, or null if there is none. */
export async function lookupAccount(env: Env, uid: string): Promise<AuthAccount | null> {
  const { users } = (await post(env, 'lookup', { localId: [uid] })) as {
    users?: { localId: string; email?: string; emailVerified?: boolean }[];
  };
  const user = users?.[0];
  return user
    ? { uid: user.localId, email: user.email ?? null, emailVerified: user.emailVerified === true }
    : null;
}

/** Marks the account's email address as verified (FR-1.2). */
export async function markEmailVerified(env: Env, uid: string): Promise<void> {
  await post(env, 'update', { localId: uid, emailVerified: true });
}

async function post(env: Env, method: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${authUrl(env)}/accounts:${method}`, {
    method: 'POST',
    headers: { ...(await authHeaders(env)), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Firebase Auth ${method} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function emulated(env: Env): boolean {
  return Boolean(env.FIREBASE_AUTH_EMULATOR_HOST) && isDemoProject(env);
}

function authUrl(env: Env): string {
  const base = emulated(env)
    ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';
  return `${base}/projects/${env.FIREBASE_PROJECT_ID}`;
}

async function authHeaders(env: Env): Promise<Record<string, string>> {
  if (emulated(env)) {
    return { Authorization: 'Bearer owner' };
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT is not set');
  }
  return { Authorization: `Bearer ${await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT)}` };
}
