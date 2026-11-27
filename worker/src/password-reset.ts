import { sendEmail } from './email';
import { countEmail } from './email-limits';
import type { Env } from './env';
import {
  FIREBASE_UID,
  lookupAccount,
  lookupAccountByEmail,
  setPassword,
  type AuthAccount,
} from './firebase-auth';
import { getDocument } from './firestore';
import { HttpError, json, readJson } from './http';
import { signLink, verifyLink } from './links';
import { MEMBERS, PASSWORD_RESETS, USERS } from './model';
import { ADMIN_ROLES } from './roles';

// Password reset (FR-1.4, NKB-203) and a new admin's first password (FR-1.8, NKB-208). Like email
// verification (verification.ts), the Worker sends its own signed link with a template from
// email-templates.ts (FR-8.5). The signature covers when the password was last set, so the link
// stops working once it has been used: setting the password changes that time. Nothing needs to be
// stored to make it one-time. The two kinds of link sign different first parts, so neither works
// as the other.

/** The two kinds of emailed password link, each the app page it opens. */
type PasswordLink = 'reset-password' | 'set-password';

export const RESET_LINK_HOURS = 1;
/** Longer than a reset, since a new admin may not see the email at once. */
export const SET_PASSWORD_LINK_HOURS = 72;
/** The shortest password allowed, as on the app's sign-up page. Firebase's own minimum is 6. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * POST /v1/password/reset-link with { email }: emails a reset link if a password account uses that
 * address. No sign-in, since the caller has forgotten their password. The answer is the same
 * whether or not there is such an account, and whether or not a limit (email-limits.ts) held the
 * email back, so the page always says to check for the email.
 */
export async function sendPasswordResetEmail(
  request: Request,
  env: Env,
  now = Date.now(),
): Promise<Response> {
  const { email } = await readJson(request);
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email.trim()) || email.length > 254) {
    throw new HttpError(400, 'Enter a valid email address');
  }

  const account = await lookupAccountByEmail(env, email.trim());
  if (!account?.email || account.disabled || !(await canSetPassword(env, account))) {
    return json({ requested: true });
  }
  // The first name from the member's profile, for the greeting. An account that has not registered
  // yet has none, and is greeted without it.
  const profile = await getDocument(env, `${MEMBERS}/${account.uid}`);
  const firstName = typeof profile?.['firstNames'] === 'string' ? profile['firstNames'] : undefined;
  const counted = await countEmail(env, PASSWORD_RESETS, account.uid, now);
  if (counted.refused) {
    return json({ requested: true });
  }

  const link = await passwordLink(env, 'reset-password', account, RESET_LINK_HOURS, now);
  try {
    await sendEmail(env, { email: account.email }, 'resetPassword', {
      firstName,
      link,
      expiresInHours: RESET_LINK_HOURS,
    });
  } catch {
    // sendEmail has logged why. An email that was not sent does not count.
    await counted.uncount().catch(() => undefined);
    throw new HttpError(502, 'The email could not be sent');
  }
  return json({ requested: true });
}

/**
 * POST /v1/password/reset with { uid, expires, sig } from the emailed link and the new password:
 * sets it. Without a password it only checks the link, so the page can say at once if the link
 * will not work, and answers with the address it is for. No sign-in; the signature is the
 * permission.
 */
export function resetPassword(request: Request, env: Env, now = Date.now()): Promise<Response> {
  return usePasswordLink('reset-password', request, env, now);
}

/**
 * POST /v1/password/set: the same for the link a new admin is emailed (FR-1.8, admins.ts), which
 * sets their first password.
 */
export function setFirstPassword(request: Request, env: Env, now = Date.now()): Promise<Response> {
  return usePasswordLink('set-password', request, env, now);
}

/**
 * A one-time link to the app page for this kind of link, signed for the account as it is now: it
 * must already have a password, so a new admin's account is created with a random one.
 */
export async function passwordLink(
  env: Env,
  kind: PasswordLink,
  account: AuthAccount,
  hours: number,
  now = Date.now(),
): Promise<string> {
  const expires = String(Math.floor(now / 1000) + hours * 3600);
  const sig = await signLink(env, linkParts(kind, account, expires));
  return `${env.APP_URL}/${kind}?${new URLSearchParams({ uid: account.uid, expires, sig })}`;
}

async function usePasswordLink(
  kind: PasswordLink,
  request: Request,
  env: Env,
  now: number,
): Promise<Response> {
  const { uid, expires, sig, password } = await readJson(request);
  const invalid = new HttpError(400, 'This link is not valid or has already been used');
  if (
    typeof uid !== 'string' ||
    !FIREBASE_UID.test(uid) ||
    typeof expires !== 'string' ||
    !/^\d{1,12}$/.test(expires) ||
    typeof sig !== 'string'
  ) {
    throw invalid;
  }

  const account = await lookupAccount(env, uid);
  if (!account?.email || account.disabled || !(await canSetPassword(env, account))) {
    throw invalid;
  }
  if (!(await verifyLink(env, linkParts(kind, account, expires), sig))) {
    throw invalid;
  }
  if (Number(expires) * 1000 <= now) {
    throw new HttpError(410, 'This link has expired');
  }
  if (password === undefined) {
    return json({ email: account.email });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  await setPassword(env, uid, password);
  return json({ reset: true });
}

/**
 * Whether the account, enabled and with an address, may be sent a link to set its password. A
 * disabled account cannot log in whatever its password. A member's account without a password
 * signs in another way, such as with Google, and has nothing to reset. An admin's may have lost
 * its password to a Google login with a @gmail.com address (NKB-213), and setting one is how they
 * get their login back, so theirs is allowed. Such a link still works once: setting the password
 * changes passwordUpdatedAt from none to a time, which the signature covers.
 */
async function canSetPassword(env: Env, account: AuthAccount): Promise<boolean> {
  if (account.passwordUpdatedAt !== null) {
    return true;
  }
  const user = await getDocument(env, `${USERS}/${account.uid}`);
  return ADMIN_ROLES.includes(String(user?.['role']));
}

// What the link's signature covers. Its kind first, so one kind never works as the other. The
// address, so a link sent to an address the account no longer has stops working, and when the
// password was set, so the link works once.
function linkParts(kind: PasswordLink, account: AuthAccount, expires: string): string[] {
  return [kind, account.uid, account.email ?? '', String(account.passwordUpdatedAt), expires];
}
