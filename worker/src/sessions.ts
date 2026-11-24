import type { User } from './auth';
import type { Env } from './env';
import { getDocument, runTransaction, type Fields } from './firestore';
import { HttpError } from './http';
import { SESSIONS } from './model';
import { ADMIN_ROLES } from './roles';

// Session expiry (FR-1.10, NKB-205). Each sign-in is known by its sign-in time (the ID token's
// auth_time, which stays the same as Firebase renews the token). sessions/{uid} keeps when each of
// the account's sign-ins last called the Worker, and a sign-in idle for longer than its role
// allows is refused, as is an admin sign-in older than the admin maximum. The app calls GET /v1/me
// while someone is using it, so app use that only reads Firestore still counts as activity. The
// Firestore rules make the same checks for admin reads.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface SessionLimits {
  /** How long a sign-in may go without activity. */
  idleSeconds: number;
  /** How long a sign-in may last at all, or null for no limit. */
  maxSeconds: number | null;
}

/** Admins get shorter sessions than members (FR-1.10). Keep firestore.rules in step. */
export const MEMBER_LIMITS: SessionLimits = { idleSeconds: 30 * DAY, maxSeconds: null };
export const ADMIN_LIMITS: SessionLimits = { idleSeconds: 30 * MINUTE, maxSeconds: 12 * HOUR };

/**
 * How often a sign-in's activity is written. Calls in between only read it, which keeps writes
 * well within Firestore's free limit. The rules allow for the delay.
 */
export const ACTIVITY_WRITE_SECONDS = 60;

export const SESSION_EXPIRED = 'Your session has expired. Please log in again.';

/** What GET /v1/me tells the app about its sign-in, so it logs out on time by itself too. */
export interface SessionInfo {
  idleSeconds: number;
  /** When the sign-in ends whatever its activity, in milliseconds since 1970, or null. */
  expiresAt: number | null;
}

export function sessionLimits(role: string): SessionLimits {
  return ADMIN_ROLES.includes(role) ? ADMIN_LIMITS : MEMBER_LIMITS;
}

/**
 * Refuses a sign-in that has expired with 401, which the app answers by logging out, and otherwise
 * records its activity. requireAccount calls it on every call (users.ts).
 */
export async function touchSession(
  env: Env,
  user: User,
  role: string,
  now = Date.now(),
): Promise<SessionInfo> {
  const limits = sessionLimits(role);
  const signedInAt = user.authTime * 1000;
  const expiresAt = limits.maxSeconds === null ? null : signedInAt + limits.maxSeconds * 1000;
  if (expiresAt !== null && now >= expiresAt) {
    throw new HttpError(401, SESSION_EXPIRED);
  }

  const path = `${SESSIONS}/${user.uid}`;
  const key = String(user.authTime);
  // A sign-in with no record yet has been idle at most since it began, so a sign-in whose record
  // was removed as expired cannot come back as new.
  const recorded = signIns(await getDocument(env, path))[key]?.getTime();
  const lastActive = recorded ?? signedInAt;
  if (now - lastActive > limits.idleSeconds * 1000) {
    throw new HttpError(401, SESSION_EXPIRED);
  }

  if (recorded === undefined || now - lastActive >= ACTIVITY_WRITE_SECONDS * 1000) {
    // In a transaction, so two sign-ins writing at once both keep their times.
    await runTransaction(env, async (tx) => {
      const [current] = await tx.getAll(path);
      const kept = Object.entries(signIns(current)).filter(
        ([, at]) => now - at.getTime() <= MEMBER_LIMITS.idleSeconds * 1000,
      );
      tx.set(path, { signIns: { ...Object.fromEntries(kept), [key]: new Date(now) } });
    });
  }
  return { idleSeconds: limits.idleSeconds, expiresAt };
}

function signIns(record: Fields | null): Record<string, Date> {
  const value = record?.['signIns'];
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Date] => entry[1] instanceof Date),
  );
}
