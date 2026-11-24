import { requireUser, type User } from './auth';
import type { Env } from './env';
import { commit, FirestoreError, getDocument, SERVER_TIME, WriteBatch } from './firestore';
import { setRoleClaim } from './firebase-auth';
import { HttpError } from './http';
import { ROLES, USERS, type Role } from './model';
import { type SessionInfo, touchSession } from './sessions';

/** The signed-in caller with the role from their users record. */
export interface Account extends User {
  /** One of ROLES, as stored. Check it with requireAdmin rather than comparing it here. */
  role: string;
  /** The sign-in's limits (NKB-205). */
  session: SessionInfo;
}

/**
 * Every endpoint except the health check calls this first (FR-1.11). It checks the sign-in and
 * reads the caller's users record, so the role is current on every call and a removed admin loses
 * access at once. The first call from a new account creates its record as a member, which is why
 * the app calls GET /v1/me straight after sign-up. An account whose email address is not yet
 * verified is refused, so it cannot log in (FR-1.2, verification.ts). A sign-in that has expired
 * is refused with 401, and otherwise its activity is recorded (FR-1.10, sessions.ts).
 */
export async function requireAccount(request: Request, env: Env): Promise<Account> {
  const user = await requireUser(request, env);
  if (!user.emailVerified) {
    throw new HttpError(403, 'Verify your email address first');
  }
  const role = await userRole(env, user);
  const session = await touchSession(env, user, role);
  await syncRoleClaim(env, user, role);
  return { ...user, role, session };
}

// The Firestore rules read the role from the token (NKB-204), so when the token's claim differs
// from the record, which is the source of truth, correct it; the token has the new claim after its
// next refresh. A token with no claim is a member's. A failure is logged, not raised, since the
// Worker has read the right role itself and the rules only matter for the app's own reads.
async function syncRoleClaim(env: Env, user: User, role: string): Promise<void> {
  if ((user.roleClaim ?? 'member') === role || !isRole(role)) {
    return;
  }
  try {
    await setRoleClaim(env, user.uid, role);
  } catch (error) {
    console.error('Role claim not updated', { uid: user.uid, error: String(error) });
  }
}

function isRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

async function userRole(env: Env, user: User): Promise<string> {
  const path = `${USERS}/${user.uid}`;
  const record = await getDocument(env, path);
  if (record) {
    return String(record['role']);
  }

  // create, not set: admin accounts (NKB-208) write their own record, which must not be replaced
  // by a member one if their first call races with it.
  const batch = new WriteBatch();
  batch.create(path, { role: 'member', email: user.email, createdAt: SERVER_TIME });
  try {
    await commit(env, batch);
    return 'member';
  } catch (error) {
    if (!(error instanceof FirestoreError && error.status === 'ALREADY_EXISTS')) {
      throw error;
    }
    return String((await getDocument(env, path))?.['role']);
  }
}
