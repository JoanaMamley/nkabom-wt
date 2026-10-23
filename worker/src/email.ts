import { brevo, type Address, type EmailProvider, gmail, logOnly } from './email-providers';
import { type EmailData, type EmailTemplate, renderEmail } from './email-templates';
import type { Env } from './env';

// The one way the Worker sends email (FR-8.5). EMAIL_PROVIDER picks the provider: "gmail" in the
// deployed Workers, "log" locally (wrangler.jsonc). Secrets are set with wrangler secret put (see
// the README).

/**
 * Google allows a personal Gmail account about 500 emails a day, counted over a rolling 24 hours
 * (support.google.com/mail/answer/22839), and staging and production share the one account.
 * Large sends, such as the yearly profile reminder (FR-2.5, NKB-308), send at most this many a
 * day, leaving room for approvals, invites and alerts.
 */
export const BULK_EMAILS_PER_DAY = 100;

function provider(env: Env): { provider: EmailProvider; from: string } {
  const name = env.EMAIL_PROVIDER ?? 'gmail';
  switch (name) {
    case 'gmail':
      // Gmail sends from the signed-in account's own address.
      return {
        provider: gmail(env.GMAIL_USER ?? '', env.GMAIL_APP_PASSWORD ?? ''),
        from: env.GMAIL_USER ?? '',
      };
    case 'brevo':
      return { provider: brevo(env.BREVO_API_KEY ?? ''), from: env.EMAIL_FROM ?? '' };
    case 'log':
      return { provider: logOnly(), from: env.EMAIL_FROM ?? 'no-reply@nkabom.test' };
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${name}"`);
  }
}

/**
 * Renders a template and sends it, for example:
 *
 *   await sendEmail(env, { email, name }, 'registrationApproved', { firstName, appUrl });
 *
 * A failed send is logged, without the message body (it may hold a one-time link), and then
 * thrown, so the caller can retry or fall back.
 */
export async function sendEmail<T extends EmailTemplate>(
  env: Env,
  to: Address,
  template: T,
  data: EmailData<T>,
): Promise<void> {
  const { subject, text, html } = renderEmail(template, data);

  try {
    const { provider: chosen, from } = provider(env);
    await chosen.send({
      from: { email: from, name: env.EMAIL_FROM_NAME ?? 'Nkabom' },
      to,
      subject,
      text,
      html,
      tag: template,
    });
  } catch (cause) {
    console.error('Email send failed', {
      provider: env.EMAIL_PROVIDER ?? 'gmail',
      template,
      to: to.email,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
}
