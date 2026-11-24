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
import { MEMBERS, PASSWORD_RESETS } from './model';

// Password reset (FR-1.4, NKB-203). Like email verification (verification.ts), the Worker sends its
// own signed link with a template from email-templates.ts (FR-8.5). The signature covers when the
// password was last set, so the link stops working once it has been used: setting the password
// changes that time. Nothing needs to be stored to make it one-time.

export const RESET_LINK_HOURS = 1;
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
  // An account without a password signs in another way, such as with Google, and has nothing to
  // reset. A disabled account cannot log in whatever its password.
  if (!account?.email || account.passwordUpdatedAt === null || account.disabled) {
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

  const expires = String(Math.floor(now / 1000) + RESET_LINK_HOURS * 3600);
  const sig = await signLink(env, linkParts(account, expires));
  const link = `${env.APP_URL}/reset-password?${new URLSearchParams({ uid: account.uid, expires, sig })}`;
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
export async function resetPassword(
  request: Request,
  env: Env,
  now = Date.now(),
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
  if (!account?.email || account.passwordUpdatedAt === null || account.disabled) {
    throw invalid;
  }
  if (!(await verifyLink(env, linkParts(account, expires), sig))) {
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

// What the link's signature covers. The address, so a link sent to an address the account no
// longer has stops working, and when the password was set, so the link works once.
function linkParts(account: AuthAccount, expires: string): string[] {
  return [
    'reset-password',
    account.uid,
    account.email ?? '',
    String(account.passwordUpdatedAt),
    expires,
  ];
}
