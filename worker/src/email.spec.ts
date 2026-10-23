import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendEmail } from './email';
import type { Env } from './env';
import { stagingEnv } from './test-helpers';

const ama = { email: 'ama@example.com', name: 'Ama Mensah' };
const invite = {
  name: 'Ama',
  link: 'https://nkabom.example/set-password?code=secret',
  expiresInHours: 1,
};

function brevoEnv(overrides: Partial<Env> = {}): Env {
  return stagingEnv({
    EMAIL_PROVIDER: 'brevo',
    EMAIL_FROM: 'no-reply@nkabom.example',
    EMAIL_FROM_NAME: 'Nkabom',
    BREVO_API_KEY: 'brevo-key',
    ...overrides,
  });
}

let fetch: ReturnType<typeof vi.fn>;
let logError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetch = vi.fn().mockResolvedValue(new Response('{"messageId":"1"}', { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendEmail', () => {
  it('renders the template and sends it from the configured sender', async () => {
    await sendEmail(brevoEnv(), ama, 'registrationApproved', {
      firstName: 'Ama',
      appUrl: 'https://nkabom.example',
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.sender).toEqual({ email: 'no-reply@nkabom.example', name: 'Nkabom' });
    expect(body.to).toEqual([ama]);
    expect(body.subject).toBe('Welcome to Nkabom');
    expect(body.textContent).toContain('Hello Ama,');
    expect(body.tags).toEqual(['registrationApproved']);
    expect(logError).not.toHaveBeenCalled();
  });

  it('switches provider by configuration alone', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await sendEmail(brevoEnv({ EMAIL_PROVIDER: 'log' }), ama, 'adminInvite', invite);

    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Email not sent (EMAIL_PROVIDER=log)',
      expect.objectContaining({ to: 'ama@example.com', subject: 'Set your password for Nkabom' }),
    );
  });

  it('uses Gmail when no provider is set', async () => {
    await expect(sendEmail(stagingEnv(), ama, 'adminInvite', invite)).rejects.toThrow(
      'GMAIL_USER and GMAIL_APP_PASSWORD are not set',
    );

    expect(logError).toHaveBeenCalledWith(
      'Email send failed',
      expect.objectContaining({ provider: 'gmail' }),
    );
  });

  it('logs a failed send, without the message body, and rethrows', async () => {
    fetch.mockResolvedValue(new Response('{"message":"Key not found"}', { status: 401 }));

    await expect(sendEmail(brevoEnv(), ama, 'adminInvite', invite)).rejects.toThrow(
      'Brevo answered 401',
    );

    expect(logError).toHaveBeenCalledWith('Email send failed', {
      provider: 'brevo',
      template: 'adminInvite',
      to: 'ama@example.com',
      error: 'Brevo answered 401: {"message":"Key not found"}',
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('code=secret');
  });

  it('logs and rethrows an unknown provider', async () => {
    await expect(
      sendEmail(brevoEnv({ EMAIL_PROVIDER: 'carrier-pigeon' }), ama, 'adminInvite', invite),
    ).rejects.toThrow('Unknown EMAIL_PROVIDER "carrier-pigeon"');

    expect(logError).toHaveBeenCalledWith(
      'Email send failed',
      expect.objectContaining({ provider: 'carrier-pigeon', template: 'adminInvite' }),
    );
  });

  it('logs and rethrows a missing API key', async () => {
    await expect(
      sendEmail(brevoEnv({ BREVO_API_KEY: undefined }), ama, 'adminInvite', invite),
    ).rejects.toThrow('BREVO_API_KEY is not set');
    expect(logError).toHaveBeenCalledOnce();
  });
});
