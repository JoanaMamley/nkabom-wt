import { describe, expect, it } from 'vitest';

import { escapeHtml, renderEmail } from './email-templates';

describe('renderEmail', () => {
  it('builds the text version from the greeting, paragraphs, link and sign-off', () => {
    const email = renderEmail('registrationApproved', {
      firstName: 'Ama',
      appUrl: 'https://nkabom.example/login',
    });

    expect(email.subject).toBe('Welcome to Nkabom');
    expect(email.text).toBe(
      [
        'Hello Ama,',
        'Your registration has been approved. You can now log in to see the mentor directory and the rest of Nkabom.',
        'Open Nkabom: https://nkabom.example/login',
        'Nkabom, the WomenTrust alumnae community',
      ].join('\n\n'),
    );
  });

  it('shows the link as a button in the HTML version', () => {
    const { html } = renderEmail('profileReminder', {
      firstName: 'Ama',
      profileUrl: 'https://nkabom.example/profile',
    });

    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<a href="https://nkabom.example/profile"');
    expect(html).toContain('Check my details</a>');
  });

  it('escapes what people typed, so a name or reason cannot inject HTML', () => {
    const { html, text } = renderEmail('registrationRejected', {
      firstName: '<b>Ama</b>',
      reason: 'Use "Ama & Co" <script>',
    });

    expect(html).toContain('Hello &lt;b&gt;Ama&lt;/b&gt;,');
    expect(html).toContain('Reason given: Use &quot;Ama &amp; Co&quot; &lt;script&gt;');
    expect(html).not.toContain('<script>');
    // The text version is plain text, so it stays as typed.
    expect(text).toContain('Reason given: Use "Ama & Co" <script>');
  });

  it('leaves out the reason line when no reason is given', () => {
    const { text } = renderEmail('registrationRejected', { firstName: 'Ama' });

    expect(text).not.toContain('Reason given');
  });

  it('gives the admin invite expiry in hours', () => {
    const one = renderEmail('adminInvite', {
      name: 'Efua',
      link: 'https://x.example',
      expiresInHours: 1,
    });
    const many = renderEmail('adminInvite', {
      name: 'Efua',
      link: 'https://x.example',
      expiresInHours: 72,
    });

    expect(one.text).toContain('expires in 1 hour.');
    expect(many.text).toContain('expires in 72 hours.');
  });

  it("puts only the member's name in an admin alert", () => {
    const { text } = renderEmail('newRegistration', {
      adminName: 'Efua',
      memberName: 'Ama Mensah',
      pendingUrl: 'https://nkabom.example/admin/pending',
    });

    expect(text).toContain('Ama Mensah has registered and is waiting for approval.');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">Tom's & co</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; co&lt;/a&gt;',
    );
  });
});
