import { describe, expect, it } from 'vitest';

import { buildMessage, encodeHeader, formatAddress } from './mime';

const message = {
  from: { email: 'nkabom@example.com', name: 'Nkabom' },
  to: { email: 'ama@example.com', name: 'Ama Mensah' },
  subject: 'Welcome to Nkabom',
  text: 'Hello Ama,\n\nWelcome.',
  html: '<p>Hello Ama,</p>',
  tag: 'registrationApproved',
};

function decodePart(raw: string, type: string): string {
  const start = raw.indexOf(`Content-Type: ${type}; charset=UTF-8`);
  const body = raw.slice(raw.indexOf('\r\n\r\n', start) + 4, raw.indexOf('\r\n--', start));
  const binary = atob(body.replace(/\r\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

describe('buildMessage', () => {
  const raw = buildMessage(message, {
    date: new Date('2026-10-23T08:00:00Z'),
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  });

  it('writes the headers', () => {
    const headers = raw.slice(0, raw.indexOf('\r\n\r\n'));

    expect(headers.split('\r\n')).toEqual([
      'From: "Nkabom" <nkabom@example.com>',
      'To: "Ama Mensah" <ama@example.com>',
      'Subject: Welcome to Nkabom',
      'Date: Fri, 23 Oct 2026 08:00:00 GMT',
      'Message-ID: <0f8fad5b-d9cb-469f-a165-70867728950e@example.com>',
      'X-Nkabom-Template: registrationApproved',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="nkabom-0f8fad5b-d9cb-469f-a165-70867728950e"',
    ]);
  });

  it('carries both the text and HTML versions', () => {
    expect(decodePart(raw, 'text/plain')).toBe('Hello Ama,\n\nWelcome.');
    expect(decodePart(raw, 'text/html')).toBe('<p>Hello Ama,</p>');
    expect(raw.endsWith('--nkabom-0f8fad5b-d9cb-469f-a165-70867728950e--\r\n')).toBe(true);
  });

  it('keeps every line short and ends lines with CRLF', () => {
    const long = buildMessage({ ...message, text: 'x'.repeat(5000) });

    expect(long.split('\r\n').every((line) => line.length <= 998)).toBe(true);
    expect(long.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('keeps non-ASCII text intact', () => {
    const raw = buildMessage({ ...message, text: 'Akwaaba, Ɛfua! 🎉' });

    expect(decodePart(raw, 'text/plain')).toBe('Akwaaba, Ɛfua! 🎉');
  });
});

describe('formatAddress', () => {
  it('quotes the name, escaping quotes in it', () => {
    expect(formatAddress({ email: 'ama@example.com', name: 'Ama "Maa" Mensah' })).toBe(
      '"Ama \\"Maa\\" Mensah" <ama@example.com>',
    );
  });

  it('leaves out a missing name', () => {
    expect(formatAddress({ email: 'ama@example.com' })).toBe('<ama@example.com>');
  });

  it('cannot be used to add a header', () => {
    const header = `To: ${formatAddress({ email: 'ama@example.com', name: 'Ama\r\nBcc: eve@example.com' })}`;

    expect(header).not.toContain('\r\n');
  });

  it.each(['ama', 'ama@example.com>', 'a b@example.com', 'ama@example.com\r\nBcc: x@y.z'])(
    'refuses %j',
    (email) => {
      expect(() => formatAddress({ email })).toThrow('Not a valid email address');
    },
  );
});

describe('encodeHeader', () => {
  it('leaves ASCII as it is', () => {
    expect(encodeHeader('Welcome to Nkabom')).toBe('Welcome to Nkabom');
  });

  it('encodes other text as UTF-8 words of under 75 characters', () => {
    const encoded = encodeHeader('Akwaaba, Ɛfua Ɔsei-Mensah, wo ho te sɛn? 🎉');
    const words = encoded.split('\r\n ');

    expect(words.every((word) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(word))).toBe(true);
    expect(words.every((word) => word.length < 75)).toBe(true);
    const decoded = words
      .map((word) => {
        const binary = atob(word.slice(10, -2));
        return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
      })
      .join('');
    expect(decoded).toBe('Akwaaba, Ɛfua Ɔsei-Mensah, wo ho te sɛn? 🎉');
  });
});
