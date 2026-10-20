import { error } from 'firebase-functions/logger';
import { defineSecret, defineString } from 'firebase-functions/params';

import { type Address, brevo, type EmailProvider, logOnly } from './email-providers';
import { type EmailData, type EmailTemplate, renderEmail } from './email-templates';

// The one way Cloud Functions send email (FR-8.5). EMAIL_PROVIDER picks the provider: "brevo" in
// deployed projects, "log" in the emulators (functions/.env.demo-nkabom). Set the secret with
// firebase functions:secrets:set (see the README).
const emailProvider = defineString('EMAIL_PROVIDER', { default: 'brevo' });
const emailFrom = defineString('EMAIL_FROM', {
  description: 'Sender address, on a domain verified with the email provider',
});
const emailFromName = defineString('EMAIL_FROM_NAME', { default: 'Nkabom' });
const brevoApiKey = defineSecret('BREVO_API_KEY');

/** Add to every function that sends email: onCall({ secrets: emailSecrets }, ...). */
export const emailSecrets = [brevoApiKey];

function provider(): EmailProvider {
  switch (emailProvider.value()) {
    case 'brevo':
      return brevo(brevoApiKey.value());
    case 'log':
      return logOnly();
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${emailProvider.value()}"`);
  }
}

/**
 * Renders a template and sends it, for example:
 *
 *   await sendEmail({ email, name }, 'registrationApproved', { firstName, appUrl });
 *
 * A failed send is logged to Cloud Logging, without the message body (it may hold a one-time
 * link), and then thrown, so the caller can retry or fall back.
 */
export async function sendEmail<T extends EmailTemplate>(
  to: Address,
  template: T,
  data: EmailData<T>,
): Promise<void> {
  const { subject, text, html } = renderEmail(template, data);

  try {
    await provider().send({
      from: { email: emailFrom.value(), name: emailFromName.value() },
      to,
      subject,
      text,
      html,
      tag: template,
    });
  } catch (cause) {
    error('Email send failed', {
      provider: emailProvider.value(),
      template,
      to: to.email,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
}
