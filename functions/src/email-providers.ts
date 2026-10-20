import { info } from 'firebase-functions/logger';

// Transactional email providers. Each one only delivers a rendered message; templates and
// failure logging live in email.ts, so adding a provider means adding one function here and one
// case in email.ts.

export const SEND_TIMEOUT_MS = 10_000;

export interface Address {
  email: string;
  name?: string;
}

export interface OutgoingEmail {
  from: Address;
  to: Address;
  subject: string;
  text: string;
  html: string;
  /** The template name, for the provider's own statistics. */
  tag: string;
}

export interface EmailProvider {
  name: string;
  /** Resolves once the provider has accepted the message, and throws if it did not. */
  send(message: OutgoingEmail): Promise<void>;
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/** Brevo's transactional email API. The free plan allows 300 emails a day. */
export function brevo(apiKey: string): EmailProvider {
  return {
    name: 'brevo',
    async send(message) {
      if (!apiKey) {
        throw new Error('BREVO_API_KEY is not set');
      }

      const response = await fetch(BREVO_URL, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: message.from,
          to: [message.to],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
          tags: [message.tag],
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new Error(`Brevo answered ${response.status}: ${body}`);
      }
    },
  };
}

/**
 * Writes the message to the Functions log instead of sending it, for the emulators. Never use it
 * in a deployed project: the log would hold one-time links such as set-password links.
 */
export function logOnly(): EmailProvider {
  return {
    name: 'log',
    async send(message) {
      info('Email not sent (EMAIL_PROVIDER=log)', {
        to: message.to.email,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
