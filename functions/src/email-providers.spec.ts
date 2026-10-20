import { afterEach, describe, expect, it, vi } from 'vitest';

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ info }));

import { brevo, logOnly, type OutgoingEmail } from './email-providers';

const message: OutgoingEmail = {
  from: { email: 'no-reply@nkabom.example', name: 'Nkabom' },
  to: { email: 'ama@example.com', name: 'Ama Mensah' },
  subject: 'Welcome to Nkabom',
  text: 'Hello Ama,',
  html: '<p>Hello Ama,</p>',
  tag: 'registrationApproved',
};

afterEach(() => {
  vi.unstubAllGlobals();
  info.mockReset();
});

describe('brevo', () => {
  it("posts the message to Brevo's transactional email API with the API key", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"messageId":"1"}', { status: 201 }));
    vi.stubGlobal('fetch', fetch);

    await brevo('brevo-key').send(message);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe('brevo-key');
    expect(JSON.parse(init.body)).toEqual({
      sender: { email: 'no-reply@nkabom.example', name: 'Nkabom' },
      to: [{ email: 'ama@example.com', name: 'Ama Mensah' }],
      subject: 'Welcome to Nkabom',
      textContent: 'Hello Ama,',
      htmlContent: '<p>Hello Ama,</p>',
      tags: ['registrationApproved'],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws with Brevo's answer when it refuses the message", async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
        ),
    );

    await expect(brevo('wrong-key').send(message)).rejects.toThrow(
      'Brevo answered 401: {"code":"unauthorized","message":"Key not found"}',
    );
  });

  it('throws when the network call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(brevo('brevo-key').send(message)).rejects.toThrow('fetch failed');
  });

  it('refuses to send without an API key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(brevo('').send(message)).rejects.toThrow('BREVO_API_KEY is not set');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('logOnly', () => {
  it('logs the message instead of sending it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await logOnly().send(message);

    expect(fetch).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Email not sent (EMAIL_PROVIDER=log)', {
      to: 'ama@example.com',
      subject: 'Welcome to Nkabom',
      text: 'Hello Ama,',
    });
  });
});
