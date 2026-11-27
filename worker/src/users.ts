import { requireUser, type User } from './auth';
import type { Env } from './env';
import {
  commit,
  FirestoreError,
  getDocument,
  SERVER_TIME,
  WriteBatch,
  type Fields,
} from './firestore';
import { removeSignInProvider, setRoleClaim } from './firebase-auth';
import { HttpError } from './http';
import { ADMIN_ROLES } from './roles';
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
 * reads the caller's users record, so the role is current on every call and a demoted or
 * deactivated admin loses access at once. The first call from a new account creates its record as
 * a member, which is why the app calls GET /v1/me straight after sign-up. An account whose email address is not yet
 * verified is refused, so it cannot log in (FR-1.2, verification.ts). A sign-in that has expired
 * is refused with 401, and otherwise its activity is recorded (FR-1.10, sessions.ts).
 */
export async function requireAccount(request: Request, env: Env): Promise<Account> {
  const user = await requireUser(request, env);
  if (!user.emailVerified) {
    throw new HttpError(403, 'Verify your email address first');
  }
  const { role, status } = await userRecord(env, user);
  // A deactivated admin (NKB-209) is refused as a revoked sign-in is, with 401, so the app logs
  // them out. Firebase refuses their sign-ins too (requireUser), but the record is checked here
  // so it alone is enough, as it is for the rules.
  if (status === 'deactivated') {
    throw new HttpError(401, 'This account has been deactivated');
  }
  // FR-1.9: admins log in with email and password only, so an admin signed in another way, such
  // as with Google (NKB-210), gets nothing. The rules check the same.
  if (ADMIN_ROLES.includes(role) && user.signInProvider !== 'password') {
    await undoAdminSignIn(env, user);
    throw new HttpError(403, ADMIN_PASSWORD_ONLY);
  }
  const session = await touchSession(env, user, role);
  await syncRoleClaim(env, user, role);
  return { ...user, role, session };
}

/** The refusal for an admin who signed in another way than with their password (FR-1.9). */
export const ADMIN_PASSWORD_ONLY =
  'Admins log in with email and password. Log in with your password, or use "Forgot password?" if it is not accepted.';

// For @gmail.com addresses Firebase has already added Google to the admin's account by the time
// the Worker sees the sign-in, and may have taken the password off (NKB-213). Taking Google off
// again and revoking the sign-in (and with it the admin's other sign-ins) leaves the account as
// it was, or, if the password went, with "Forgot password?" to set one (password-reset.ts). A failure is logged, not raised: the refusal matters more,
// and the admin can still set a password.
async function undoAdminSignIn(env: Env, user: User): Promise<void> {
  if (!user.signInProvider) {
    return;
  }
  try {
    await removeSignInProvider(env, user.uid, user.signInProvider);
  } catch (error) {
    console.error('Admin sign-in not undone', {
      uid: user.uid,
      provider: user.signInProvider,
      error: String(error),
    });
  }
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

/** The account's role and status from its users record, creating a member's on the first call. */
async function userRecord(env: Env, user: User): Promise<{ role: string; status: string }> {
  const path = `${USERS}/${user.uid}`;
  const read = (record: Fields | null) => ({
    role: String(record?.['role']),
    status: String(record?.['status'] ?? 'active'),
  });
  const record = await getDocument(env, path);
  if (record) {
    return read(record);
  }

  // create, not set: admin accounts (NKB-208) write their own record, which must not be replaced
  // by a member one if their first call races with it.
  const batch = new WriteBatch();
  batch.create(path, { role: 'member', email: user.email, createdAt: SERVER_TIME });
  try {
    await commit(env, batch);
    return { role: 'member', status: 'active' };
  } catch (error) {
    if (!(error instanceof FirestoreError && error.status === 'ALREADY_EXISTS')) {
      throw error;
    }
    return read(await getDocument(env, path));
  }
}
