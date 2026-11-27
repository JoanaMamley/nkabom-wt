import { requireUser, type User } from './auth';
import type { Env } from './env';
import {
  commit,
  findDocuments,
  runTransaction,
  FirestoreError,
  getDocument,
  SERVER_TIME,
  WriteBatch,
  type Fields,
} from './firestore';
import { recordAudit } from './audit';
import { sendEmail } from './email';
import { setRoleClaim } from './firebase-auth';
import { HttpError } from './http';
import { ADMIN_ROLES, ADMIN_SIGN_IN_PROVIDERS } from './roles';
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
  const { role, status, googleNoticeSent } = await userRecord(env, user);
  // A deactivated admin (NKB-209) is refused as a revoked sign-in is, with 401, so the app logs
  // them out. Firebase refuses their sign-ins too (requireUser), but the record is checked here
  // so it alone is enough, as it is for the rules.
  if (status === 'deactivated') {
    throw new HttpError(401, 'This account has been deactivated');
  }
  // FR-1.9: admins log in with email and password, or with Google once it is linked to their
  // admin account (NKB-213), and any other way gets nothing. The rules check the same.
  const admin = ADMIN_ROLES.includes(role);
  if (admin && !ADMIN_SIGN_IN_PROVIDERS.includes(user.signInProvider ?? '')) {
    throw new HttpError(403, 'Admins log in with email and password or Google');
  }
  const session = await touchSession(env, user, role);
  await syncRoleClaim(env, user, role);
  const account = { ...user, role, session };
  if (admin && user.signInProvider === 'google.com' && !googleNoticeSent) {
    await noticeAdminGoogleSignIn(env, account);
  }
  return account;
}

/**
 * The first time an admin's account is signed in to with Google (NKB-213), records it in the
 * audit log and tells the admin and the other active Primary Admins by email, so someone can raise
 * the alarm if it was not the admin: Google then guards the admin account as much as the password
 * does. The other Primary Admins matter most for a @gmail.com address, whose inbox whoever holds
 * the Google account can read. The users record's googleSignInNoticeAt marks it done, set in the
 * same transaction as the audit entry, so two calls at once send one round of emails. A failure
 * is logged, not raised, so it never stops the admin's own call; emails that fail after the commit
 * are not sent again.
 */
async function noticeAdminGoogleSignIn(env: Env, account: Account): Promise<void> {
  const path = `${USERS}/${account.uid}`;
  try {
    const record = await runTransaction(env, async (tx) => {
      const [current] = await tx.getAll(path);
      if (!current || current['googleSignInNoticeAt']) {
        return null;
      }
      tx.update(path, { googleSignInNoticeAt: SERVER_TIME });
      recordAudit(tx, account, 'admin.googleSignIn', { type: 'admin', id: account.uid });
      return current;
    });
    if (!record) {
      return;
    }
    const name = typeof record['name'] === 'string' ? record['name'] : (account.name ?? undefined);
    const emails: Promise<void>[] = [];
    if (account.email) {
      emails.push(sendEmail(env, { email: account.email }, 'adminGoogleSignIn', { name }));
    }
    const primaryAdmins = await findDocuments(env, USERS, 'role', 'primaryAdmin');
    for (const [uid, admin] of primaryAdmins) {
      const email = admin['email'];
      if (uid !== account.uid && admin['status'] !== 'deactivated' && typeof email === 'string') {
        emails.push(
          sendEmail(env, { email }, 'adminGoogleSignInAlert', {
            adminName: name ?? account.email ?? 'An admin',
            adminEmail: account.email ?? '',
          }),
        );
      }
    }
    // sendEmail logs why one failed; the others are still sent.
    await Promise.allSettled(emails);
  } catch (error) {
    console.error('Google sign-in notice not sent', { uid: account.uid, error: String(error) });
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

/**
 * The account's role and status from its users record, and whether an admin has been told of their
 * first Google sign-in (NKB-213), creating a member's record on the first call.
 */
async function userRecord(
  env: Env,
  user: User,
): Promise<{ role: string; status: string; googleNoticeSent: boolean }> {
  const path = `${USERS}/${user.uid}`;
  const read = (record: Fields | null) => ({
    role: String(record?.['role']),
    status: String(record?.['status'] ?? 'active'),
    googleNoticeSent: Boolean(record?.['googleSignInNoticeAt']),
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
    return { role: 'member', status: 'active', googleNoticeSent: false };
  } catch (error) {
    if (!(error instanceof FirestoreError && error.status === 'ALREADY_EXISTS')) {
      throw error;
    }
    return read(await getDocument(env, path));
  }
}
