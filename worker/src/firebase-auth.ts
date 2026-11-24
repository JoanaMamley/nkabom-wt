import { isDemoProject, type Env } from './env';
import { getAccessToken } from './google';

// Firebase Auth's REST API (Identity Toolkit v1), as the service account. Like Firestore, the
// emulator takes "owner" as a token with admin rights.

/** Firebase user IDs: letters and digits only. */
export const FIREBASE_UID = /^[A-Za-z0-9]{1,128}$/;

/** A Firebase Auth account, as far as the Worker needs it. */
export interface AuthAccount {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  disabled: boolean;
  /**
   * When the password was last set, in milliseconds since 1970, or null for an account without a
   * password (such as a Google login).
   */
  passwordUpdatedAt: number | null;
}

/** The account with this user ID, or null if there is none. */
export async function lookupAccount(env: Env, uid: string): Promise<AuthAccount | null> {
  return firstAccount(await post(env, 'lookup', { localId: [uid] }));
}

/** The account with this email address (in any case), or null if there is none. */
export async function lookupAccountByEmail(env: Env, email: string): Promise<AuthAccount | null> {
  return firstAccount(await post(env, 'lookup', { email: [email] }));
}

/** Marks the account's email address as verified (FR-1.2). */
export async function markEmailVerified(env: Env, uid: string): Promise<void> {
  await post(env, 'update', { localId: uid, emailVerified: true });
}

/**
 * Sets a new password (FR-1.4). Firebase also ends the account's other sign-ins. The address is
 * marked verified too, since only its owner could open the emailed link that leads here.
 */
export async function setPassword(env: Env, uid: string, password: string): Promise<void> {
  await post(env, 'update', { localId: uid, password, emailVerified: true });
}

function firstAccount(response: unknown): AuthAccount | null {
  const user = (
    response as {
      users?: {
        localId: string;
        email?: string;
        emailVerified?: boolean;
        disabled?: boolean;
        passwordUpdatedAt?: number;
      }[];
    }
  ).users?.[0];
  return user
    ? {
        uid: user.localId,
        email: user.email ?? null,
        emailVerified: user.emailVerified === true,
        disabled: user.disabled === true,
        passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      }
    : null;
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
