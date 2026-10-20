import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { error, info } = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ error, info, warn: vi.fn() }));

import { sendEmail } from './email';

const env = {
  EMAIL_PROVIDER: 'brevo',
  EMAIL_FROM: 'no-reply@nkabom.example',
  EMAIL_FROM_NAME: 'Nkabom',
  BREVO_API_KEY: 'brevo-key',
};

const ama = { email: 'ama@example.com', name: 'Ama Mensah' };
const invite = {
  name: 'Ama',
  link: 'https://nkabom.example/set-password?code=secret',
  expiresInHours: 1,
};

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(process.env, env);
  fetch = vi.fn().mockResolvedValue(new Response('{"messageId":"1"}', { status: 201 }));
  vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
  Object.keys(env).forEach((name) => delete process.env[name]);
  vi.unstubAllGlobals();
  error.mockReset();
  info.mockReset();
});

describe('sendEmail', () => {
  it('renders the template and sends it from the configured sender', async () => {
    await sendEmail(ama, 'registrationApproved', {
      firstName: 'Ama',
      appUrl: 'https://nkabom.example',
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.sender).toEqual({ email: 'no-reply@nkabom.example', name: 'Nkabom' });
    expect(body.to).toEqual([ama]);
    expect(body.subject).toBe('Welcome to Nkabom');
    expect(body.textContent).toContain('Hello Ama,');
    expect(body.tags).toEqual(['registrationApproved']);
    expect(error).not.toHaveBeenCalled();
  });

  it('switches provider by configuration alone', async () => {
    process.env.EMAIL_PROVIDER = 'log';

    await sendEmail(ama, 'adminInvite', invite);

    expect(fetch).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      'Email not sent (EMAIL_PROVIDER=log)',
      expect.objectContaining({ to: 'ama@example.com', subject: 'Set your password for Nkabom' }),
    );
  });

  it('logs a failed send, without the message body, and rethrows', async () => {
    fetch.mockResolvedValue(new Response('{"message":"Key not found"}', { status: 401 }));

    await expect(sendEmail(ama, 'adminInvite', invite)).rejects.toThrow('Brevo answered 401');

    expect(error).toHaveBeenCalledWith('Email send failed', {
      provider: 'brevo',
      template: 'adminInvite',
      to: 'ama@example.com',
      error: 'Brevo answered 401: {"message":"Key not found"}',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('code=secret');
  });

  it('logs and rethrows an unknown provider', async () => {
    process.env.EMAIL_PROVIDER = 'carrier-pigeon';

    await expect(sendEmail(ama, 'adminInvite', invite)).rejects.toThrow(
      'Unknown EMAIL_PROVIDER "carrier-pigeon"',
    );

    expect(error).toHaveBeenCalledWith(
      'Email send failed',
      expect.objectContaining({ provider: 'carrier-pigeon', template: 'adminInvite' }),
    );
  });

  it('logs and rethrows a missing API key', async () => {
    delete process.env.BREVO_API_KEY;

    await expect(sendEmail(ama, 'adminInvite', invite)).rejects.toThrow('BREVO_API_KEY is not set');
    expect(error).toHaveBeenCalledOnce();
  });
});
