import { recordAudit } from './audit';
import { sendEmail } from './email';
import type { Env } from './env';
import {
  commit,
  findDocuments,
  runTransaction,
  SERVER_TIME,
  WriteBatch,
  type Fields,
  type Transaction,
} from './firestore';
import {
  createAccount,
  deleteAccount,
  disableAccount,
  enableAccount,
  FIREBASE_UID,
  lookupAccount,
  lookupAccountByEmail,
  setRoleClaim,
} from './firebase-auth';
import { HttpError, json, readJson } from './http';
import {
  EMAIL_VERIFICATIONS,
  PASSWORD_RESETS,
  SESSIONS,
  USERS,
  type AccountStatus,
  type Role,
} from './model';
import { passwordLink, SET_PASSWORD_LINK_HOURS } from './password-reset';
import { ADMIN_ROLES, requirePrimaryAdmin, requireRecentSignIn } from './roles';
import type { Account } from './users';

// Admin accounts (FR-1.6, FR-1.7). The first Primary Admin comes from
// scripts/create-primary-admin.mjs; after that a Primary Admin creates the others here (NKB-208)
// and lists, promotes, demotes, deactivates, reactivates and deletes them (NKB-209).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_NAME_LENGTH = 100;

/**
 * POST /v1/admins with { name, email, calendarEmail? }, by a Primary Admin: creates an admin
 * account and emails the new admin a one-time link to set their password (FR-1.8). The account
 * has a password from the start, a random one no one sees, so it logs in with email and password
 * only (FR-1.9), and the link can be signed for it. calendarEmail is the Google account for the
 * birthday calendar (NKB-505), and defaults to the login address.
 *
 * Steps that can fail come first, and a failure removes the account again, so a Primary Admin who
 * sees an error can simply try again: the account, then the email, then the users record that makes
 * it an admin, written with its audit entry (FR-8.3). The role claim comes last, as the Worker sets
 * it on the admin's first call if it is missing.
 */
export async function createAdmin(request: Request, env: Env, actor: Account): Promise<Response> {
  requirePrimaryAdmin(actor);
  requireRecentSignIn(actor);
  const body = await readJson(request);
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
  const calendarEmail =
    typeof body['calendarEmail'] === 'string' && body['calendarEmail'].trim()
      ? body['calendarEmail'].trim().toLowerCase()
      : email;
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `Enter a name of at most ${MAX_NAME_LENGTH} characters`);
  }
  // Line breaks and other control characters would end up in the greeting of the email, the
  // account's display name and the audit log.
  if (/\p{Cc}/u.test(name)) {
    throw new HttpError(400, 'Enter the name on one line, without special characters');
  }
  if (!EMAIL.test(email) || email.length > 254) {
    throw new HttpError(400, 'Enter a valid login email address');
  }
  if (!EMAIL.test(calendarEmail) || calendarEmail.length > 254) {
    throw new HttpError(400, 'Enter a valid calendar email address');
  }
  // One account per address: a member's account is not turned into an admin one here.
  const taken = new HttpError(409, 'That email address already has an account');
  if (await lookupAccountByEmail(env, email)) {
    throw taken;
  }

  let uid: string;
  try {
    uid = await createAccount(env, { email, displayName: name, password: randomPassword() });
  } catch (error) {
    // Another request created an account for the address since the lookup.
    if (error instanceof Error && error.message.includes('EMAIL_EXISTS')) {
      throw taken;
    }
    throw error;
  }
  try {
    const account = await lookupAccount(env, uid);
    if (!account) {
      throw new Error('The new account could not be read back');
    }
    const link = await passwordLink(env, 'set-password', account, SET_PASSWORD_LINK_HOURS);
    try {
      await sendEmail(env, { email, name }, 'adminInvite', {
        name,
        link,
        expiresInHours: SET_PASSWORD_LINK_HOURS,
      });
    } catch {
      // sendEmail has logged why.
      throw new HttpError(502, 'The email could not be sent, so the admin was not created');
    }

    const batch = new WriteBatch();
    batch.create(`${USERS}/${uid}`, {
      role: 'admin',
      email,
      name,
      calendarEmail,
      createdAt: SERVER_TIME,
    });
    recordAudit(batch, actor, 'admin.create', { type: 'admin', id: uid }, { email });
    await commit(env, batch);
  } catch (error) {
    await deleteAccount(env, uid).catch((cause: unknown) =>
      console.error('New admin account not removed', { uid, error: String(cause) }),
    );
    throw error;
  }

  try {
    await setRoleClaim(env, uid, 'admin');
  } catch (error) {
    console.error('Role claim not set', { uid, error: String(error) });
  }
  return json({ uid, email, name, calendarEmail }, 201);
}

/** 32 random bytes, which no one sees: the admin replaces it through the emailed link. */
function randomPassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** An admin as GET /v1/admins lists them. */
export interface AdminSummary {
  uid: string;
  name: string | null;
  email: string | null;
  calendarEmail: string | null;
  role: Role;
  status: AccountStatus;
  /** Whether this is the caller, whose own account they cannot change here. */
  self: boolean;
}

/** GET /v1/admins, by a Primary Admin: every admin account, by name. */
export async function listAdmins(env: Env, actor: Account): Promise<Response> {
  requirePrimaryAdmin(actor);
  const found = await Promise.all(
    ADMIN_ROLES.map((role) => findDocuments(env, USERS, 'role', role)),
  );
  // An admin whose role changed between the two queries could come back from both, so key by ID.
  const records = new Map(found.flatMap((byId) => [...byId]));
  const admins: AdminSummary[] = [...records]
    .map(([uid, record]): AdminSummary => ({
      uid,
      name: optionalString(record['name']),
      email: optionalString(record['email']),
      calendarEmail: optionalString(record['calendarEmail']),
      role: record['role'] as Role,
      status: record['status'] === 'deactivated' ? 'deactivated' : 'active',
      self: uid === actor.uid,
    }))
    .sort((a, b) => (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? ''));
  return json({ admins });
}

/**
 * PATCH /v1/admins/{uid} with { role }, by a Primary Admin: promotes an admin to Primary Admin or
 * demotes a Primary Admin to admin (FR-1.7). The users record changes with its audit entry, which
 * takes effect at once; the role claim follows, as the Worker corrects it on the admin's next call
 * if it fails here.
 */
export async function setAdminRole(
  request: Request,
  env: Env,
  actor: Account,
  uid: string,
): Promise<Response> {
  requirePrimaryAdmin(actor);
  requireRecentSignIn(actor);
  const body = await readJson(request);
  const role = body['role'];
  if (role !== 'admin' && role !== 'primaryAdmin') {
    throw new HttpError(400, 'Choose admin or primaryAdmin');
  }
  const changed = await changeAdmin(env, actor, uid, (target, tx) => {
    if (target['status'] === 'deactivated') {
      throw new HttpError(
        409,
        'A deactivated admin’s role cannot be changed. Reactivate them first.',
      );
    }
    if (target['role'] === role) {
      return false;
    }
    tx.update(`${USERS}/${uid}`, { role });
    recordAudit(
      tx,
      actor,
      'admin.roleChange',
      { type: 'admin', id: uid },
      { from: String(target['role']), to: role, email: optionalString(target['email']) },
    );
    return true;
  });
  if (changed) {
    try {
      await setRoleClaim(env, uid, role);
    } catch (error) {
      console.error('Role claim not updated', { uid, error: String(error) });
    }
  }
  return json({ uid, role });
}

/**
 * POST /v1/admins/{uid}/deactivate, by a Primary Admin (FR-1.6). The users record is marked
 * deactivated and the admin's session record removed, so the Worker and the rules refuse them at
 * once; then their Firebase account is disabled and its sign-ins revoked, so they cannot sign in
 * again and requireUser refuses the sign-ins they have. Deactivating again does only that last step,
 * so a Primary Admin who sees it fail can try again.
 */
export async function deactivateAdmin(env: Env, actor: Account, uid: string): Promise<Response> {
  requirePrimaryAdmin(actor);
  requireRecentSignIn(actor);
  await changeAdmin(env, actor, uid, (target, tx) => {
    if (markDeactivated(tx, uid, target)) {
      recordAudit(
        tx,
        actor,
        'admin.deactivate',
        { type: 'admin', id: uid },
        { email: optionalString(target['email']) },
      );
    }
  });
  try {
    await disableAccount(env, uid);
  } catch (error) {
    console.error('Admin account not disabled', { uid, error: String(error) });
    throw new HttpError(
      502,
      'The admin was deactivated in Nkabom, but their sign-in could not be turned off. Try again.',
    );
  }
  return json({ uid, status: 'deactivated' });
}

/**
 * POST /v1/admins/{uid}/reactivate, by a Primary Admin: undoes a deactivation, keeping the admin's
 * user ID, password, role and audit history. The users record is marked active first, then the
 * Firebase account is enabled again; until then the admin still cannot sign in, so a failure keeps
 * them out, and reactivating again does only that last step. The sign-ins they had when deactivated
 * stay revoked, so they log in afresh. An admin whose Firebase account is gone, as when a deletion
 * stopped part-way, cannot be reactivated, only deleted.
 */
export async function reactivateAdmin(env: Env, actor: Account, uid: string): Promise<Response> {
  requirePrimaryAdmin(actor);
  requireRecentSignIn(actor);
  // An admin whose deletion stopped part-way has no account left to enable; marking them active
  // would only leave a record that cannot sign in.
  if (FIREBASE_UID.test(uid) && uid !== actor.uid && !(await lookupAccount(env, uid))) {
    throw new HttpError(409, 'This admin’s sign-in has been deleted. Delete them to finish.');
  }
  await changeAdmin(env, actor, uid, (target, tx) => {
    if (target['status'] !== 'deactivated') {
      return;
    }
    tx.update(`${USERS}/${uid}`, { status: 'active', reactivatedAt: SERVER_TIME });
    recordAudit(
      tx,
      actor,
      'admin.reactivate',
      { type: 'admin', id: uid },
      { email: optionalString(target['email']) },
    );
  });
  try {
    await enableAccount(env, uid);
  } catch (error) {
    console.error('Admin account not enabled', { uid, error: String(error) });
    throw new HttpError(
      502,
      'The admin was reactivated in Nkabom, but their sign-in could not be turned back on. Try again.',
    );
  }
  return json({ uid, status: 'active' });
}

/**
 * DELETE /v1/admins/{uid}, by a Primary Admin (FR-1.6). The admin is deactivated first, so they
 * are refused at once and stay refused if a later step fails; then their Firebase account is
 * deleted, and last their users record and the other records kept for the account, with the audit
 * entry. Each step can be repeated, so a Primary Admin who sees an error can simply try again.
 */
export async function deleteAdmin(env: Env, actor: Account, uid: string): Promise<Response> {
  requirePrimaryAdmin(actor);
  requireRecentSignIn(actor);
  const email = await changeAdmin(env, actor, uid, (target, tx) => {
    markDeactivated(tx, uid, target);
    return optionalString(target['email']);
  });
  try {
    await deleteAccount(env, uid);
  } catch (error) {
    console.error('Admin account not deleted', { uid, error: String(error) });
    throw new HttpError(
      502,
      'The admin’s sign-in could not be deleted, so they have been deactivated instead. Try again.',
    );
  }
  const batch = new WriteBatch();
  for (const collection of [USERS, SESSIONS, EMAIL_VERIFICATIONS, PASSWORD_RESETS]) {
    batch.delete(`${collection}/${uid}`);
  }
  recordAudit(batch, actor, 'admin.delete', { type: 'admin', id: uid }, { email });
  await commit(env, batch);
  return json({ uid, deleted: true });
}

/**
 * Runs change on another admin's users record in a transaction that also reads the caller's own,
 * and commits what it writes. FR-1.7 says the last Primary Admin can never be demoted or deleted:
 * the caller must still be an active Primary Admin when the transaction commits, and cannot act on
 * their own account, so whatever change is made, the caller remains a Primary Admin. Two Primary
 * Admins demoting each other at once cannot both succeed, since each transaction reads the record
 * the other writes, and Firestore makes the second try again, when it finds its caller demoted.
 */
async function changeAdmin<T>(
  env: Env,
  actor: Account,
  uid: string,
  change: (target: Fields, tx: Transaction) => T,
): Promise<T> {
  if (!FIREBASE_UID.test(uid)) {
    throw new HttpError(404, 'No such admin');
  }
  if (uid === actor.uid) {
    throw new HttpError(
      403,
      'You cannot change your own admin account. Ask another Primary Admin.',
    );
  }
  return runTransaction(env, async (tx) => {
    const [self, target] = await tx.getAll(`${USERS}/${actor.uid}`, `${USERS}/${uid}`);
    if (self?.['role'] !== 'primaryAdmin' || self['status'] === 'deactivated') {
      throw new HttpError(403, 'Only a Primary Admin can do this');
    }
    if (!target || !ADMIN_ROLES.includes(String(target['role']))) {
      throw new HttpError(404, 'No such admin');
    }
    return change(target, tx);
  });
}

/** Marks the admin deactivated and ends their sessions, unless done already. Whether it did. */
function markDeactivated(tx: Transaction, uid: string, target: Fields): boolean {
  if (target['status'] === 'deactivated') {
    return false;
  }
  tx.update(`${USERS}/${uid}`, { status: 'deactivated', deactivatedAt: SERVER_TIME });
  tx.delete(`${SESSIONS}/${uid}`);
  return true;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
