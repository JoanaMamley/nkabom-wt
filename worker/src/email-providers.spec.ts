import { afterEach, describe, expect, it, vi } from 'vitest';

import { brevo, gmail, logOnly, type OutgoingEmail } from './email-providers';
import { fakeSmtp } from './fake-smtp';

const message: OutgoingEmail = {
  from: { email: 'nkabom@example.com', name: 'Nkabom' },
  to: { email: 'ama@example.com', name: 'Ama Mensah' },
  subject: 'Welcome to Nkabom',
  text: 'Hello Ama,',
  html: '<p>Hello Ama,</p>',
  tag: 'registrationApproved',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('gmail', () => {
  it("sends through Gmail's mail server on port 465, signed in with the app password", async () => {
    const server = fakeSmtp();

    await gmail('nkabom@example.com', 'abcd efgh ijkl mnop', server.open).send(message);

    expect(server.host).toBe('smtp.gmail.com');
    expect(server.port).toBe(465);
    expect(server.commands).toEqual([
      'EHLO nkabom',
      `AUTH PLAIN ${btoa('\0nkabom@example.com\0abcdefghijklmnop')}`,
      'MAIL FROM:<nkabom@example.com>',
      'RCPT TO:<ama@example.com>',
      'DATA',
      '<message>',
      'QUIT',
    ]);
    expect(server.message()).toContain('Subject: Welcome to Nkabom\r\n');
    expect(server.message()).toContain('To: "Ama Mensah" <ama@example.com>\r\n');
    expect(server.closed).toBe(true);
  });

  it('throws with Gmail’s answer when it refuses the app password, without the password', async () => {
    const server = fakeSmtp({
      refuse: {
        command: 'AUTH',
        reply:
          '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 https://support.google.com/mail/?p=BadCredentials',
      },
    });

    const sending = gmail('nkabom@example.com', 'wrong-password', server.open).send(message);

    await expect(sending).rejects.toThrow(
      'Gmail answered AUTH with: 535-5.7.8 Username and Password not accepted. 535 5.7.8 https://support.google.com/mail/?p=BadCredentials',
    );
    await sending.catch((error: Error) => {
      expect(error.message).not.toContain(btoa('\0nkabom@example.com\0wrong-password'));
    });
    expect(server.closed).toBe(true);
  });

  it('throws when Gmail refuses the message, without the message itself', async () => {
    const server = fakeSmtp({
      refuse: { command: '<message>', reply: '550 5.4.5 Daily user sending limit exceeded' },
    });

    const sending = gmail('nkabom@example.com', 'app-password', server.open).send(message);

    await expect(sending).rejects.toThrow(
      'Gmail answered message with: 550 5.4.5 Daily user sending limit exceeded',
    );
  });

  it('gives up when the server does not answer', async () => {
    vi.useFakeTimers();
    const server = fakeSmtp({ silent: true });

    const sending = gmail('nkabom@example.com', 'app-password', server.open).send(message);
    const result = expect(sending).rejects.toThrow('No answer from smtp.gmail.com within 10 s');
    await vi.advanceTimersByTimeAsync(10_000);

    await result;
    expect(server.closed).toBe(true);
    vi.useRealTimers();
  });

  it('refuses a recipient address that could add commands', async () => {
    const server = fakeSmtp();

    await expect(
      gmail('nkabom@example.com', 'app-password', server.open).send({
        ...message,
        to: { email: 'ama@example.com>\r\nRCPT TO:<eve@example.com' },
      }),
    ).rejects.toThrow('Not a valid email address');
    expect(server.commands).toEqual([]);
  });

  it('refuses to send without the Gmail secrets', async () => {
    const server = fakeSmtp();

    await expect(gmail('', '', server.open).send(message)).rejects.toThrow(
      'GMAIL_USER and GMAIL_APP_PASSWORD are not set',
    );
    expect(server.host).toBeUndefined();
  });
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
      sender: { email: 'nkabom@example.com', name: 'Nkabom' },
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
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await logOnly().send(message);

    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Email not sent (EMAIL_PROVIDER=log)', {
      to: 'ama@example.com',
      subject: 'Welcome to Nkabom',
      text: 'Hello Ama,',
    });
  });
});
