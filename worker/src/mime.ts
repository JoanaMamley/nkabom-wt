import type { Address, OutgoingEmail } from './email-providers';

// Builds the message Gmail's mail server is given: headers, then the plain-text and HTML versions
// as a multipart/alternative body, each base64-encoded so any text and line length is safe.

const CRLF = '\r\n';

export function buildMessage(
  message: OutgoingEmail,
  { date = new Date(), id = crypto.randomUUID() } = {},
): string {
  const boundary = `nkabom-${id}`;
  const domain = message.from.email.split('@')[1];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      ...wrap(base64(body), 76),
    ].join(CRLF);

  return [
    `From: ${formatAddress(message.from)}`,
    `To: ${formatAddress(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    `X-Nkabom-Template: ${clean(message.tag)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', message.text),
    part('text/html', message.html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

// Addresses go into the SMTP envelope and the headers, so anything that could end a line or
// start another address is refused.
const ADDRESS = /^[^\s<>()@,;:"\\]+@[^\s<>()@,;:"\\]+$/;

export function checkAddress(email: string): string {
  if (!ADDRESS.test(email)) {
    throw new Error('Not a valid email address');
  }
  return email;
}

export function formatAddress({ email, name }: Address): string {
  checkAddress(email);
  if (!name) {
    return `<${email}>`;
  }
  const display = /^[\x20-\x7e]*$/.test(clean(name))
    ? `"${clean(name).replace(/[\\"]/g, '\\$&')}"`
    : encodeHeader(name);
  return `${display} <${email}>`;
}

/** Names and subjects are typed by people, so non-ASCII text is sent as RFC 2047 encoded words. */
export function encodeHeader(text: string): string {
  const value = clean(text);
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }
  // Each encoded word stays under 75 characters: 10 characters are at most 40 UTF-8 bytes.
  const chars = Array.from(value);
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += 10) {
    words.push(`=?UTF-8?B?${base64(chars.slice(i, i + 10).join(''))}?=`);
  }
  return words.join(`${CRLF} `);
}

// A line break in a header would let typed-in text add headers of its own.
function clean(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

function base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    lines.push(text.slice(i, i + width));
  }
  return lines;
}
