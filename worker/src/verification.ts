import type { User } from './auth';
import { sendEmail } from './email';
import { countEmail, type EmailRefusal } from './email-limits';
import type { Env } from './env';
import { FIREBASE_UID, lookupAccount, markEmailVerified } from './firebase-auth';
import { HttpError, json, readJson } from './http';
import { signLink, verifyLink } from './links';
import { EMAIL_VERIFICATIONS } from './model';

// Email sign-up verification (FR-1.2, NKB-202). The Worker sends its own link, signed like the
// photo links, so the email uses the templates in email-templates.ts (FR-8.5) and the expiry is
// ours. Until the address is verified, requireAccount refuses the account (users.ts) and the
// Firestore rules give it nothing.

export const VERIFY_LINK_HOURS = 24;

const REFUSALS: Record<EmailRefusal, string> = {
  tooSoon: 'Please wait a minute before asking for another email',
  accountLimit: 'Too many emails today. Please try again tomorrow',
  allLimit: 'Nkabom has sent all the emails it can today. Please try again tomorrow',
};

/**
 * POST /v1/email/verification: emails the signed-in caller a link to verify their address. Called
 * by the app straight after sign-up, and again from its "resend" button. Takes a sign-in that is
 * not yet verified, so it uses requireUser, not requireAccount.
 */
export async function sendVerificationEmail(
  env: Env,
  user: User,
  now = Date.now(),
): Promise<Response> {
  if (user.emailVerified) {
    return json({ alreadyVerified: true });
  }
  if (!user.email) {
    throw new HttpError(400, 'Your account has no email address');
  }

  const counted = await countEmail(env, EMAIL_VERIFICATIONS, user.uid, now);
  if (counted.refused) {
    throw new HttpError(429, REFUSALS[counted.refused]);
  }

  const expires = String(Math.floor(now / 1000) + VERIFY_LINK_HOURS * 3600);
  const sig = await signLink(env, ['verify-email', user.uid, user.email, expires]);
  const link = `${env.APP_URL}/verify-email?${new URLSearchParams({ uid: user.uid, expires, sig })}`;
  try {
    await sendEmail(env, { email: user.email }, 'verifyEmail', {
      link,
      expiresInHours: VERIFY_LINK_HOURS,
    });
  } catch {
    // sendEmail has logged why. An email that was not sent does not count, and the caller can try
    // again straight away.
    await counted.uncount().catch(() => undefined);
    throw new HttpError(502, 'The email could not be sent');
  }

  return json({ sentTo: user.email });
}

/**
 * POST /v1/email/verify with { uid, expires, sig } from the emailed link: marks the address as
 * verified. No sign-in is needed, since the link may be opened on another device; the signature
 * is the permission. It covers the address the link was sent to, so a link for an address the
 * account no longer has is refused.
 */
export async function confirmVerification(
  request: Request,
  env: Env,
  now = Date.now(),
): Promise<Response> {
  const { uid, expires, sig } = await readJson(request);
  const invalid = new HttpError(400, 'This link is not valid');
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
  if (!account?.email) {
    throw invalid;
  }
  if (!(await verifyLink(env, ['verify-email', uid, account.email, expires], sig))) {
    throw invalid;
  }
  if (account.emailVerified) {
    return json({ verified: true });
  }
  if (Number(expires) * 1000 <= now) {
    throw new HttpError(410, 'This link has expired');
  }

  await markEmailVerified(env, uid);
  return json({ verified: true });
}
