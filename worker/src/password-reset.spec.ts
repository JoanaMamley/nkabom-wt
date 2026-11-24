import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RESEND_SECONDS } from './email-limits';
import { FakeFirestore } from './fake-firestore';
import worker from './index';
import {
  MIN_PASSWORD_LENGTH,
  RESET_LINK_HOURS,
  resetPassword,
  sendPasswordResetEmail,
} from './password-reset';
import { emulatorEnv } from './test-helpers';

const env = emulatorEnv({ PHOTO_LINK_KEY: 'test-link-key', EMAIL_PROVIDER: 'log' });
const NOW = Date.parse('2026-11-02T10:00:00Z');

interface FakeAccount {
  email?: string;
  emailVerified: boolean;
  disabled?: boolean;
  password?: string;
  passwordUpdatedAt?: number;
}

let firestore: FakeFirestore;
let accounts: Map<string, FakeAccount>;
let log: ReturnType<typeof vi.spyOn>;

// Stands in for the Auth emulator, with its accounts, and the Firestore emulator. Like the
// emulator, setting a password moves passwordUpdatedAt on.
beforeEach(() => {
  firestore = new FakeFirestore();
  accounts = new Map([
    [
      'ama',
      {
        email: 'ama@example.com',
        emailVerified: true,
        password: 'old password',
        passwordUpdatedAt: NOW - 86_400_000,
      },
    ],
  ]);
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.endsWith('accounts:lookup')) {
      const email = (body['email'] as string[] | undefined)?.[0].toLowerCase();
      const uid = email
        ? [...accounts].find(([, account]) => account.email === email)?.[0]
        : (body['localId'] as string[])[0];
      const account = uid && accounts.get(uid);
      return Response.json(account ? { users: [{ localId: uid, ...account }] } : {});
    }
    if (url.endsWith('accounts:update')) {
      const account = accounts.get(body['localId'] as string)!;
      Object.assign(account, body, { passwordUpdatedAt: (account.passwordUpdatedAt ?? 0) + 1 });
      return Response.json({ localId: body['localId'] });
    }
    if (firestore.handles(url)) {
      return firestore.handle(url, init);
    }
    return new Response('unexpected request', { status: 500 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Typed as the Worker receives it, so worker.fetch takes it too.
function request(path: string, body: unknown): Request<unknown, IncomingRequestCfProperties> {
  return new Request(`https://api.test${path}`, { method: 'POST', body: JSON.stringify(body) });
}

function askForLink(email: string, now = NOW, testEnv = env) {
  return sendPasswordResetEmail(request('/v1/password/reset-link', { email }), testEnv, now);
}

function reset(link: URL | Record<string, string>, password?: string, now = NOW) {
  const params = link instanceof URL ? Object.fromEntries(link.searchParams) : link;
  return resetPassword(request('/v1/password/reset', { ...params, password }), env, now);
}

/** The links in the emails written to the log. */
function sentLinks(): URL[] {
  return (log.mock.calls as [string, { text: string }][])
    .map(([, email]) => /http\S+reset-password\S+/.exec(email.text))
    .filter((match) => match !== null)
    .map((match) => new URL(match[0]));
}

async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: { status: number; message: string }) => ({
      status: error.status,
      message: error.message,
    }),
  );
}

describe('sendPasswordResetEmail', () => {
  it('emails a link to the app that expires in an hour, whatever the case of the address', async () => {
    const response = await askForLink(' AMA@example.com ');

    expect(await response.json()).toEqual({ requested: true });
    const [, email] = log.mock.calls.at(-1) as [string, { to: string; subject: string }];
    expect(email).toMatchObject({ to: 'ama@example.com', subject: 'Reset your Nkabom password' });
    const [link] = sentLinks();
    expect(link.origin + link.pathname).toBe('http://localhost:4200/reset-password');
    expect(link.searchParams.get('uid')).toBe('ama');
    expect(Number(link.searchParams.get('expires'))).toBe(NOW / 1000 + RESET_LINK_HOURS * 3600);
  });

  it('answers the same and sends nothing when no password account uses the address', async () => {
    accounts.set('kofi', { email: 'kofi@example.com', emailVerified: true });
    accounts.set('esi', { ...accounts.get('ama')!, email: 'esi@example.com', disabled: true });

    for (const email of ['nobody@example.com', 'kofi@example.com', 'esi@example.com']) {
      expect(await (await askForLink(email)).json()).toEqual({ requested: true });
    }
    expect(sentLinks()).toEqual([]);
  });

  it('refuses something that is not an email address', async () => {
    for (const email of ['', 'ama', 'ama@', 'a b@example.com']) {
      expect(await errorOf(askForLink(email))).toEqual({
        status: 400,
        message: 'Enter a valid email address',
      });
    }
  });

  it('quietly sends nothing more within a minute, and counts in passwordResets', async () => {
    await askForLink('ama@example.com');
    const again = await askForLink('ama@example.com', NOW + 10_000);

    expect(await again.json()).toEqual({ requested: true });
    expect(sentLinks()).toHaveLength(1);
    expect(firestore.docs.get('passwordResets/ama')).toMatchObject({ count: 1 });
    expect(firestore.docs.get('passwordResets/_all')).toMatchObject({ count: 1 });

    await askForLink('ama@example.com', NOW + RESEND_SECONDS * 1000);
    expect(sentLinks()).toHaveLength(2);
  });

  it('does not count an email that failed to send', async () => {
    const broken = { ...env, EMAIL_PROVIDER: 'gmail' };

    expect((await errorOf(askForLink('ama@example.com', NOW, broken)))?.status).toBe(502);

    expect(firestore.docs.get('passwordResets/ama')).toMatchObject({ count: 0 });
    await askForLink('ama@example.com');
    expect(sentLinks()).toHaveLength(1);
  });
});

describe('resetPassword', () => {
  async function link(): Promise<URL> {
    await askForLink('ama@example.com');
    return sentLinks()[0];
  }

  it('checks the link without a password, answering with its address', async () => {
    const response = await reset(await link());

    expect(await response.json()).toEqual({ email: 'ama@example.com' });
    expect(accounts.get('ama')!.password).toBe('old password');
  });

  it('sets the new password and marks the address verified', async () => {
    accounts.get('ama')!.emailVerified = false;

    const response = await reset(await link(), 'new password', NOW + 60_000);

    expect(await response.json()).toEqual({ reset: true });
    expect(accounts.get('ama')).toMatchObject({ password: 'new password', emailVerified: true });
  });

  it('works only once', async () => {
    const sent = await link();
    await reset(sent, 'new password');

    for (const password of [undefined, 'another password']) {
      expect(await errorOf(reset(sent, password))).toEqual({
        status: 400,
        message: 'This link is not valid or has already been used',
      });
    }
    expect(accounts.get('ama')!.password).toBe('new password');
  });

  it('stops working once the password is changed another way, such as by another link', async () => {
    const first = await link();
    await askForLink('ama@example.com', NOW + RESEND_SECONDS * 1000);
    await reset(sentLinks()[1], 'new password');

    expect((await errorOf(reset(first, 'another password')))?.status).toBe(400);
  });

  it('refuses the link once it has expired', async () => {
    expect(
      await errorOf(reset(await link(), 'new password', NOW + RESET_LINK_HOURS * 3600_000)),
    ).toEqual({ status: 410, message: 'This link has expired' });
    expect(accounts.get('ama')!.password).toBe('old password');
  });

  it(`refuses a password shorter than ${MIN_PASSWORD_LENGTH} characters`, async () => {
    expect(await errorOf(reset(await link(), 'short'))).toEqual({
      status: 400,
      message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters`,
    });
    expect(accounts.get('ama')!.password).toBe('old password');
  });

  it('refuses a link with a changed user, expiry or signature', async () => {
    accounts.set('kofi', { ...accounts.get('ama')!, email: 'kofi@example.com' });
    const params = Object.fromEntries((await link()).searchParams);

    for (const changed of [
      { ...params, uid: 'kofi' },
      { ...params, expires: String(Number(params['expires']) + 3600) },
      { ...params, sig: params['sig'].slice(1) },
      { uid: 'ama' },
    ]) {
      expect((await errorOf(reset(changed, 'new password')))?.status).toBe(400);
    }
    expect(accounts.get('kofi')!.password).toBe('old password');
    expect(accounts.get('ama')!.password).toBe('old password');
  });

  it('refuses a link for an address the account no longer has, or an account turned off', async () => {
    const sent = await link();
    accounts.get('ama')!.email = 'ama.new@example.com';
    expect((await errorOf(reset(sent, 'new password')))?.status).toBe(400);

    accounts.get('ama')!.email = 'ama@example.com';
    accounts.get('ama')!.disabled = true;
    expect((await errorOf(reset(sent, 'new password')))?.status).toBe(400);
  });
});

describe('password reset endpoints', () => {
  it('send a link and reset the password without a sign-in', async () => {
    const send = await worker.fetch(
      request('/v1/password/reset-link', { email: 'ama@example.com' }),
      env,
    );
    expect(send.status).toBe(200);

    const response = await worker.fetch(
      request('/v1/password/reset', {
        ...Object.fromEntries(sentLinks()[0].searchParams),
        password: 'new password',
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(accounts.get('ama')!.password).toBe('new password');
  });
});
