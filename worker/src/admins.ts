import { recordAudit } from './audit';
import { sendEmail } from './email';
import type { Env } from './env';
import { commit, SERVER_TIME, WriteBatch } from './firestore';
import {
  createAccount,
  deleteAccount,
  lookupAccount,
  lookupAccountByEmail,
  setRoleClaim,
} from './firebase-auth';
import { HttpError, json, readJson } from './http';
import { USERS } from './model';
import { passwordLink, SET_PASSWORD_LINK_HOURS } from './password-reset';
import { requirePrimaryAdmin } from './roles';
import type { Account } from './users';

// Admin accounts (FR-1.6, NKB-208). The first Primary Admin comes from
// scripts/create-primary-admin.mjs; after that a Primary Admin creates the others here.

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
