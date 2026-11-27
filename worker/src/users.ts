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
import { markEmailVerified, setRoleClaim } from './firebase-auth';
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
 * verified is refused, so it cannot log in (FR-1.2, verification.ts), except a Facebook one
 * (trustFacebookAddress). A sign-in that has expired
 * is refused with 401, and otherwise its activity is recorded (FR-1.10, sessions.ts).
 */
export async function requireAccount(request: Request, env: Env): Promise<Account> {
  const user = await requireUser(request, env);
  if (!user.emailVerified) {
    await trustFacebookAddress(env, user);
  }
  const { role, status } = await userRecord(env, user);
  // A deactivated admin (NKB-209) is refused as a revoked sign-in is, with 401, so the app logs
  // them out. Firebase refuses their sign-ins too (requireUser), but the record is checked here
  // so it alone is enough, as it is for the rules.
  if (status === 'deactivated') {
    throw new HttpError(401, 'This account has been deactivated');
  }
  // FR-1.9: admins log in with email and password only, so an admin signed in another way, such
  // as with Google once members can (NKB-210), gets nothing. The rules check the same.
  if (ADMIN_ROLES.includes(role) && user.signInProvider !== 'password') {
    throw new HttpError(403, 'Admins log in with email and password');
  }
  const session = await touchSession(env, user, role);
  await syncRoleClaim(env, user, role);
  return { ...user, role, session };
}

/**
 * Firebase often marks a Facebook account's address unverified, but Facebook gives out only
 * addresses its users have confirmed, so Nkabom counts it as verified (NKB-211) rather than
 * sending a verification email. The account is marked verified in Firebase Auth, so the app's
 * next ID token says so for the rules too (the app refreshes it after GET /v1/me), and this call
 * goes on. Any other unverified account is refused, as is a Facebook account with no address,
 * which Facebook allows for accounts made with a phone number.
 */
async function trustFacebookAddress(env: Env, user: User): Promise<void> {
  if (user.signInProvider !== 'facebook.com') {
    throw new HttpError(403, 'Verify your email address first');
  }
  if (!user.email) {
    throw new HttpError(
      403,
      'Your Facebook account has no email address. Sign up with your email address instead.',
    );
  }
  try {
    await markEmailVerified(env, user.uid);
  } catch (error) {
    console.error('Facebook address not marked verified', { uid: user.uid, error: String(error) });
    throw new HttpError(502, 'Your Facebook login could not be finished. Please try again.');
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
