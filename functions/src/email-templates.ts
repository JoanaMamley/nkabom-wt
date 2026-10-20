// Every email the app sends (FR-8.5). Each template returns plain text, and renderEmail builds
// both the text and the HTML version from it, so the two never drift apart. Add new emails here.

/** What a template says, before it is turned into text and HTML. */
export interface EmailContent {
  subject: string;
  /** Opening line, such as "Hello Ama,". */
  greeting: string;
  paragraphs: string[];
  /** A link shown as a button in HTML and as "label: url" in text. */
  action?: { label: string; url: string };
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// Admin emails carry the member's name and a link only, never date of birth or other profile
// details (FR-4.13).
export const EMAIL_TEMPLATES = {
  /** FR-1.8: a new admin sets their password with a one-time, expiring link. */
  adminInvite: (data: { name: string; link: string; expiresInHours: number }) => ({
    subject: 'Set your password for Nkabom',
    greeting: `Hello ${data.name},`,
    paragraphs: [
      'You have been made an admin of Nkabom, the WomenTrust alumnae community.',
      `Set your password with the link below before you first log in. It works once and expires in ${hours(data.expiresInHours)}.`,
    ],
    action: { label: 'Set your password', url: data.link },
  }),

  /** FR-2.9: the member's registration was approved. */
  registrationApproved: (data: { firstName: string; appUrl: string }) => ({
    subject: 'Welcome to Nkabom',
    greeting: `Hello ${data.firstName},`,
    paragraphs: [
      'Your registration has been approved. You can now log in to see the mentor directory and the rest of Nkabom.',
    ],
    action: { label: 'Open Nkabom', url: data.appUrl },
  }),

  /** FR-2.9: the member's registration was rejected, with the admin's optional reason. */
  registrationRejected: (data: { firstName: string; reason?: string }) => ({
    subject: 'Your Nkabom registration',
    greeting: `Hello ${data.firstName},`,
    paragraphs: [
      'Your registration for Nkabom was not approved.',
      ...(data.reason ? [`Reason given: ${data.reason}`] : []),
    ],
  }),

  /** FR-2.5: the yearly request to confirm or update profile details. */
  profileReminder: (data: { firstName: string; profileUrl: string }) => ({
    subject: 'Are your Nkabom details up to date?',
    greeting: `Hello ${data.firstName},`,
    paragraphs: [
      'Once a year we ask members to check their details. Please confirm they are still correct, or update them.',
    ],
    action: { label: 'Check my details', url: data.profileUrl },
  }),

  /** FR-2.10: an admin alert for a new registration. Name only (FR-4.13). */
  newRegistration: (data: { adminName: string; memberName: string; pendingUrl: string }) => ({
    subject: 'New registration to review',
    greeting: `Hello ${data.adminName},`,
    paragraphs: [`${data.memberName} has registered and is waiting for approval.`],
    action: { label: 'Review pending registrations', url: data.pendingUrl },
  }),

  /** FR-4.14: the "send a test notification" button for an admin without push. */
  testNotification: (data: { name: string; settingsUrl: string }) => ({
    subject: 'Nkabom test notification',
    greeting: `Hello ${data.name},`,
    paragraphs: ['This is the test notification you asked for. Email notifications are working.'],
    action: { label: 'Notification settings', url: data.settingsUrl },
  }),
} satisfies Record<string, (data: never) => EmailContent>;

export type EmailTemplate = keyof typeof EMAIL_TEMPLATES;
export type EmailData<T extends EmailTemplate> = Parameters<(typeof EMAIL_TEMPLATES)[T]>[0];

const SIGN_OFF = 'Nkabom, the WomenTrust alumnae community';

function hours(count: number): string {
  return count === 1 ? '1 hour' : `${count} hours`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML. Template data such as names and reasons is typed in by people. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function renderEmail<T extends EmailTemplate>(
  template: T,
  data: EmailData<T>,
): RenderedEmail {
  const content: EmailContent = (EMAIL_TEMPLATES[template] as (data: EmailData<T>) => EmailContent)(
    data,
  );
  const { greeting, paragraphs, action } = content;

  const text = [
    greeting,
    ...paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    SIGN_OFF,
  ].join('\n\n');

  const p = (line: string) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`;
  const button = action
    ? `<p style="margin:0 0 16px"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#e95300;color:#1f1a17;text-decoration:none;border-radius:6px">${escapeHtml(action.label)}</a></p>`
    : '';
  const html = [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#ffffff;color:#222222;font:16px/1.5 Arial,sans-serif">',
    '<div style="max-width:560px;margin:0 auto">',
    p(greeting),
    ...paragraphs.map(p),
    button,
    `<p style="margin:24px 0 0;color:#666666;font-size:14px">${escapeHtml(SIGN_OFF)}</p>`,
    '</div></body></html>',
  ].join('');

  return { subject: content.subject, text, html };
}
