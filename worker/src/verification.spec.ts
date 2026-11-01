import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from './auth';
import { FakeFirestore } from './fake-firestore';
import worker from './index';
import { emulatorEnv, signedIn } from './test-helpers';
import {
  confirmVerification,
  MAX_EMAILS_PER_DAY,
  RESEND_SECONDS,
  sendVerificationEmail,
  VERIFY_LINK_HOURS,
} from './verification';

const env = emulatorEnv({ PHOTO_LINK_KEY: 'test-link-key', EMAIL_PROVIDER: 'log' });
const NOW = Date.parse('2026-10-31T10:00:00Z');
const AMA: User = { uid: 'ama', name: null, email: 'ama@example.com', emailVerified: false };

interface FakeAccount {
  email?: string;
  emailVerified: boolean;
}

let firestore: FakeFirestore;
let accounts: Map<string, FakeAccount>;
let log: ReturnType<typeof vi.spyOn>;

// Stands in for the Auth emulator, with its accounts, and the Firestore emulator.
beforeEach(() => {
  firestore = new FakeFirestore();
  accounts = new Map([['ama', { email: 'ama@example.com', emailVerified: false }]]);
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.endsWith('accounts:lookup')) {
      const uid = (body['localId'] as string[])[0];
      const account = accounts.get(uid);
      return Response.json(account ? { users: [{ localId: uid, ...account }] } : {});
    }
    if (url.endsWith('accounts:update')) {
      accounts.get(body['localId'] as string)!.emailVerified = body['emailVerified'] as boolean;
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

/** The link in the last email written to the log. */
function sentLink(): URL {
  const [, email] = log.mock.calls.at(-1) as [string, { text: string }];
  return new URL(/http\S+verify-email\S+/.exec(email.text)![0]);
}

function confirm(link: URL | Record<string, string>, now = NOW) {
  const body = link instanceof URL ? Object.fromEntries(link.searchParams) : link;
  return confirmVerification(
    new Request('https://api.test/v1/email/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    env,
    now,
  );
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

describe('sendVerificationEmail', () => {
  it('emails a link to the app that expires in 24 hours', async () => {
    const response = await sendVerificationEmail(env, AMA, NOW);

    expect(await response.json()).toEqual({ sentTo: 'ama@example.com' });
    const [, email] = log.mock.calls.at(-1) as [string, { to: string; subject: string }];
    expect(email).toMatchObject({
      to: 'ama@example.com',
      subject: 'Confirm your email address for Nkabom',
    });
    const link = sentLink();
    expect(link.origin + link.pathname).toBe('http://localhost:4200/verify-email');
    expect(link.searchParams.get('uid')).toBe('ama');
    expect(Number(link.searchParams.get('expires'))).toBe(NOW / 1000 + VERIFY_LINK_HOURS * 3600);
  });

  it('sends nothing to an address that is already verified', async () => {
    const response = await sendVerificationEmail(env, { ...AMA, emailVerified: true }, NOW);

    expect(await response.json()).toEqual({ alreadyVerified: true });
    expect(log).not.toHaveBeenCalled();
  });

  it('makes the caller wait between emails', async () => {
    await sendVerificationEmail(env, AMA, NOW);

    expect(await errorOf(sendVerificationEmail(env, AMA, NOW + 10_000))).toEqual({
      status: 429,
      message: 'Please wait a minute before asking for another email',
    });
    await expect(
      sendVerificationEmail(env, AMA, NOW + RESEND_SECONDS * 1000),
    ).resolves.toBeInstanceOf(Response);
  });

  it(`sends at most ${MAX_EMAILS_PER_DAY} a day, and more the next day`, async () => {
    for (let i = 0; i < MAX_EMAILS_PER_DAY; i++) {
      await sendVerificationEmail(env, AMA, NOW + i * RESEND_SECONDS * 1000);
    }
    const later = NOW + MAX_EMAILS_PER_DAY * RESEND_SECONDS * 1000;

    expect((await errorOf(sendVerificationEmail(env, AMA, later)))?.status).toBe(429);
    await expect(
      sendVerificationEmail(env, AMA, Date.parse('2026-11-01T00:00:00Z')),
    ).resolves.toBeInstanceOf(Response);
  });

  it('does not count an email that failed to send', async () => {
    const broken = { ...env, EMAIL_PROVIDER: 'gmail' };

    expect((await errorOf(sendVerificationEmail(broken, AMA, NOW)))?.status).toBe(502);
    expect(firestore.docs.get('emailVerifications/ama')).toBeUndefined();
  });
});

describe('confirmVerification', () => {
  it('verifies the address with the emailed link', async () => {
    await sendVerificationEmail(env, AMA, NOW);

    const response = await confirm(sentLink(), NOW + 60_000);

    expect(await response.json()).toEqual({ verified: true });
    expect(accounts.get('ama')!.emailVerified).toBe(true);
  });

  it('refuses the link once it has expired', async () => {
    await sendVerificationEmail(env, AMA, NOW);

    expect(await errorOf(confirm(sentLink(), NOW + VERIFY_LINK_HOURS * 3600_000))).toEqual({
      status: 410,
      message: 'This link has expired',
    });
    expect(accounts.get('ama')!.emailVerified).toBe(false);
  });

  it('accepts the link again once verified, so a second click is not an error', async () => {
    await sendVerificationEmail(env, AMA, NOW);
    await confirm(sentLink(), NOW);

    await expect(confirm(sentLink(), NOW + 48 * 3600_000)).resolves.toBeInstanceOf(Response);
  });

  it('refuses a link with a changed user, expiry or signature', async () => {
    accounts.set('kofi', { email: 'kofi@example.com', emailVerified: false });
    await sendVerificationEmail(env, AMA, NOW);
    const link = Object.fromEntries(sentLink().searchParams);

    for (const changed of [
      { ...link, uid: 'kofi' },
      { ...link, expires: String(Number(link['expires']) + 3600) },
      { ...link, sig: link['sig'].slice(1) },
      { uid: 'ama' },
    ]) {
      expect(await errorOf(confirm(changed))).toEqual({
        status: 400,
        message: 'This link is not valid',
      });
    }
    expect(accounts.get('kofi')!.emailVerified).toBe(false);
    expect(accounts.get('ama')!.emailVerified).toBe(false);
  });

  it('refuses a link for an address the account no longer has', async () => {
    await sendVerificationEmail(env, AMA, NOW);
    accounts.get('ama')!.email = 'ama.new@example.com';

    expect((await errorOf(confirm(sentLink())))?.status).toBe(400);
  });

  it('refuses a link for an account that no longer exists', async () => {
    await sendVerificationEmail(env, AMA, NOW);
    accounts.delete('ama');

    expect((await errorOf(confirm(sentLink())))?.status).toBe(400);
  });
});

describe('verification endpoints', () => {
  it('sends the email to an unverified sign-in, which every other endpoint refuses', async () => {
    const headers = signedIn('ama', { email_verified: false });

    const me = await worker.fetch(new Request('https://api.test/v1/me', { headers }), env);
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({ error: 'Verify your email address first' });

    const send = await worker.fetch(
      new Request('https://api.test/v1/email/verification', { method: 'POST', headers }),
      env,
    );
    expect(send.status).toBe(200);
  });

  it('verifies through POST /v1/email/verify without a sign-in', async () => {
    await sendVerificationEmail(env, AMA);

    const response = await worker.fetch(
      new Request('https://api.test/v1/email/verify', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(sentLink().searchParams)),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(accounts.get('ama')!.emailVerified).toBe(true);
  });
});
