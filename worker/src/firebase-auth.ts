import { isDemoProject, type Env } from './env';
import { getAccessToken } from './google';
import type { Role } from './model';

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
  /** The account's custom claims. */
  claims: Record<string, unknown>;
  /**
   * Sign-ins from before this time, in seconds since 1970, are revoked (NKB-209): Firebase moves
   * it on when the password changes, and deactivating an admin moves it on too. Null if unset.
   */
  validSince: number | null;
}

/** The account with this user ID, or null if there is none. */
export async function lookupAccount(env: Env, uid: string): Promise<AuthAccount | null> {
  return firstAccount(await post(env, ':lookup', { localId: [uid] }));
}

/** The account with this email address (in any case), or null if there is none. */
export async function lookupAccountByEmail(env: Env, email: string): Promise<AuthAccount | null> {
  return firstAccount(await post(env, ':lookup', { email: [email] }));
}

/**
 * Creates an email and password account with its address marked verified, as the Worker and the
 * rules require (NKB-202), and returns its user ID. For admins (NKB-208), who set their own
 * password through an emailed link.
 */
export async function createAccount(
  env: Env,
  account: { email: string; displayName: string; password: string },
): Promise<string> {
  const { localId } = (await post(env, '', { ...account, emailVerified: true })) as {
    localId: string;
  };
  return localId;
}

/**
 * Deletes the account, as when creating an admin fails part-way or an admin is deleted (NKB-209).
 * An account that is already gone counts as deleted, so a deletion that failed later on can be
 * tried again.
 */
export async function deleteAccount(env: Env, uid: string): Promise<void> {
  try {
    await post(env, ':delete', { localId: uid });
  } catch (error) {
    if (!isUserNotFound(error)) {
      throw error;
    }
  }
}

function isUserNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes('USER_NOT_FOUND');
}

/**
 * Deactivates the account (FR-1.6, NKB-209): Firebase refuses its sign-ins and stops renewing their
 * ID tokens, and moving validSince on revokes the sign-ins already in progress, which requireUser
 * (auth.ts) then refuses at once. An account that is already gone cannot sign in either, so it
 * counts as disabled, as when an admin's deletion stopped part-way.
 */
export async function disableAccount(env: Env, uid: string): Promise<void> {
  try {
    await post(env, ':update', {
      localId: uid,
      disableUser: true,
      validSince: String(Math.floor(Date.now() / 1000)),
    });
  } catch (error) {
    if (!isUserNotFound(error)) {
      throw error;
    }
  }
}

/**
 * Undoes a social login on an admin's account and ends the sign-in (FR-1.9, NKB-213). Firebase
 * treats Google as the owner of @gmail.com addresses, so a Google login with an admin's address
 * signs in to the admin's account and adds Google to it, before the Worker sees anything. This
 * takes the provider off again and moves validSince on, so that sign-in is refused from now on
 * (requireUser, auth.ts). Setting a password (Forgot password?) adds the password sign-in back
 * if Firebase removed it.
 */
export async function removeSignInProvider(env: Env, uid: string, provider: string): Promise<void> {
  await post(env, ':update', {
    localId: uid,
    deleteProvider: [provider],
    validSince: String(Math.floor(Date.now() / 1000)),
  });
}

/**
 * Re-enables a deactivated account (NKB-209), which can then sign in again with its password. The
 * sign-ins revoked when it was disabled stay revoked, as validSince does not move back.
 */
export async function enableAccount(env: Env, uid: string): Promise<void> {
  await post(env, ':update', { localId: uid, disableUser: false });
}

/** Marks the account's email address as verified (FR-1.2). */
export async function markEmailVerified(env: Env, uid: string): Promise<void> {
  await post(env, ':update', { localId: uid, emailVerified: true });
}

/**
 * Sets a new password (FR-1.4). Firebase also ends the account's other sign-ins. The address is
 * marked verified too, since only its owner could open the emailed link that leads here.
 */
export async function setPassword(env: Env, uid: string, password: string): Promise<void> {
  await post(env, ':update', { localId: uid, password, emailVerified: true });
}

/**
 * Stores the role as a custom claim on the account (FR-1.11), which the Firestore rules read from
 * the ID token. The users record stays the source of truth: the Worker checks it on every call and
 * the rules check it too, so a stale claim never grants access. The token carries the new claim
 * after its next refresh. Any other claims the account has are kept.
 */
export async function setRoleClaim(env: Env, uid: string, role: Role): Promise<void> {
  const claims = (await lookupAccount(env, uid))?.claims ?? {};
  await post(env, ':update', {
    localId: uid,
    customAttributes: JSON.stringify({ ...claims, role }),
  });
}

function parseClaims(customAttributes: string | undefined): Record<string, unknown> {
  try {
    const claims: unknown = JSON.parse(customAttributes || '{}');
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
        customAttributes?: string;
        /** Seconds since 1970, as a string. */
        validSince?: string;
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
        claims: parseClaims(user.customAttributes),
        validSince: user.validSince ? Number(user.validSince) : null,
      }
    : null;
}

// method: ':lookup', ':update' and so on, or '' to create an account.
async function post(env: Env, method: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${authUrl(env)}/accounts${method}`, {
    method: 'POST',
    headers: { ...(await authHeaders(env)), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Firebase Auth ${method.slice(1) || 'create'} failed: ${response.status} ${await response.text()}`,
    );
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
