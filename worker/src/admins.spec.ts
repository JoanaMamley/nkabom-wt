import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_NAME_LENGTH } from './admins';
import type { Env } from './env';
import { FakeFirestore } from './fake-firestore';
import worker from './index';
import { MIN_PASSWORD_LENGTH, SET_PASSWORD_LINK_HOURS } from './password-reset';
import { emulatorEnv, signedIn } from './test-helpers';

const env = emulatorEnv({ PHOTO_LINK_KEY: 'test-link-key', EMAIL_PROVIDER: 'log' });

interface FakeAccount {
  email?: string;
  password?: string;
  displayName?: string;
  emailVerified?: boolean;
  passwordUpdatedAt?: number;
  customAttributes?: string;
}

let firestore: FakeFirestore;
let accounts: Map<string, FakeAccount>;
let log: ReturnType<typeof vi.spyOn>;
let created = 0;
// Firebase refuses the next create, as when another request made the account first.
let racingCreate: boolean;

// Stands in for the Auth emulator, with its accounts, and the Firestore emulator. Efua is the
// Primary Admin, Kofi an admin and Ama a member. Like the emulator, setting a password moves
// passwordUpdatedAt on.
beforeEach(() => {
  firestore = new FakeFirestore();
  firestore.docs.set('users/efua', { role: 'primaryAdmin', email: 'efua@example.com' });
  firestore.docs.set('users/kofi', { role: 'admin', email: 'kofi@example.com' });
  firestore.docs.set('users/ama', { role: 'member', email: 'ama@example.com' });
  accounts = new Map(
    ['efua', 'kofi', 'ama'].map((uid) => [
      uid,
      { email: `${uid}@example.com`, emailVerified: true, passwordUpdatedAt: 1 },
    ]),
  );
  created = 0;
  racingCreate = false;
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.endsWith('/accounts')) {
      if (racingCreate) {
        return Response.json({ error: { message: 'EMAIL_EXISTS' } }, { status: 400 });
      }
      const uid = `new${++created}`;
      accounts.set(uid, { ...(body as FakeAccount), passwordUpdatedAt: 1000 });
      return Response.json({ localId: uid });
    }
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
      const moved = 'password' in body ? { passwordUpdatedAt: account.passwordUpdatedAt! + 1 } : {};
      Object.assign(account, body, moved);
      return Response.json({ localId: body['localId'] });
    }
    if (url.endsWith('accounts:delete')) {
      accounts.delete(body['localId'] as string);
      return Response.json({});
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

function post(path: string, body: unknown, uid: string | null, testEnv: Env = env, extra = {}) {
  const request = new Request(`https://api.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(uid ? signedIn(uid, extra) : {}) },
    body: JSON.stringify(body),
  }) as Request<unknown, IncomingRequestCfProperties>;
  return worker.fetch(request, testEnv);
}

const NEW_ADMIN = { name: 'Abena Owusu', email: ' Abena@Example.com ' };

const createAdmin = (body: unknown = NEW_ADMIN, uid: string | null = 'efua', testEnv?: Env) =>
  post('/v1/admins', body, uid, testEnv);

/** The set-password links in the emails written to the log. */
function sentLinks(): URL[] {
  return (log.mock.calls as [string, { text?: string }][])
    .map(([, email]) => /http\S+set-password\S+/.exec(email?.text ?? ''))
    .filter((match) => match !== null)
    .map((match) => new URL(match[0]));
}

const useLink = (link: URL, password?: string, path = '/v1/password/set') =>
  post(path, { ...Object.fromEntries(link.searchParams), password }, null);

function auditEntries() {
  return [...firestore.docs].filter(([path]) => path.startsWith('auditLog/'));
}

/** Nothing was created: no new account, users record or audit entry, and no email. */
function expectNothingCreated() {
  expect([...accounts.keys()].filter((uid) => uid.startsWith('new'))).toEqual([]);
  expect([...firestore.docs.keys()].filter((path) => path.startsWith('users/new'))).toEqual([]);
  expect(auditEntries()).toEqual([]);
  expect(sentLinks()).toEqual([]);
}

describe('POST /v1/admins (FR-1.6)', () => {
  it('creates a verified admin account with its users record, role claim and audit entry', async () => {
    const response = await createAdmin({ ...NEW_ADMIN, calendarEmail: 'Abena.Calendar@Gmail.com' });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      uid: 'new1',
      email: 'abena@example.com',
      name: 'Abena Owusu',
      calendarEmail: 'abena.calendar@gmail.com',
    });
    expect(accounts.get('new1')).toMatchObject({
      email: 'abena@example.com',
      displayName: 'Abena Owusu',
      emailVerified: true,
    });
    expect(JSON.parse(accounts.get('new1')!.customAttributes!)).toEqual({ role: 'admin' });
    expect(accounts.get('new1')!.password).toMatch(/^[0-9a-f]{64}$/);
    expect(firestore.docs.get('users/new1')).toMatchObject({
      role: 'admin',
      email: 'abena@example.com',
      name: 'Abena Owusu',
      calendarEmail: 'abena.calendar@gmail.com',
    });
    expect(auditEntries().map(([, entry]) => entry)).toMatchObject([
      {
        actor: { uid: 'efua' },
        action: 'admin.create',
        target: { type: 'admin', id: 'new1' },
        details: { email: 'abena@example.com' },
      },
    ]);
  });

  it('uses the login address for the calendar unless given another', async () => {
    await createAdmin();
    expect(firestore.docs.get('users/new1')?.['calendarEmail']).toBe('abena@example.com');
  });

  it('emails the new admin a set-password link that expires in 72 hours (FR-1.8)', async () => {
    const before = Math.floor(Date.now() / 1000);
    await createAdmin();

    const [, email] = log.mock.calls.at(-1) as [string, { to: string; subject: string }];
    expect(email).toMatchObject({
      to: 'abena@example.com',
      subject: 'Set your password for Nkabom',
    });
    const [link] = sentLinks();
    expect(link.origin + link.pathname).toBe('http://localhost:4200/set-password');
    expect(link.searchParams.get('uid')).toBe('new1');
    const expires = Number(link.searchParams.get('expires'));
    expect(expires - before).toBeGreaterThanOrEqual(SET_PASSWORD_LINK_HOURS * 3600);
    expect(expires - before).toBeLessThan(SET_PASSWORD_LINK_HOURS * 3600 + 60);
  });

  it('refuses anyone but a Primary Admin, creating nothing', async () => {
    for (const uid of ['kofi', 'ama']) {
      const response = await createAdmin(NEW_ADMIN, uid);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Only a Primary Admin can do this' });
    }
    expect((await createAdmin(NEW_ADMIN, null)).status).toBe(401);
    expectNothingCreated();
  });

  it('refuses an address that already has an account, such as a member’s', async () => {
    const response = await createAdmin({ name: 'Ama Mensah', email: 'AMA@example.com' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'That email address already has an account' });
    expect(firestore.docs.get('users/ama')?.['role']).toBe('member');
    expectNothingCreated();
  });

  it('needs a name and valid addresses', async () => {
    for (const body of [
      { email: 'abena@example.com' },
      { name: '   ', email: 'abena@example.com' },
      { name: 'x'.repeat(MAX_NAME_LENGTH + 1), email: 'abena@example.com' },
      { name: 'Abena\nOwusu', email: 'abena@example.com' },
      { name: 'Abena\u0007Owusu', email: 'abena@example.com' },
      { name: 'Abena Owusu' },
      { name: 'Abena Owusu', email: 'not an address' },
      { name: 'Abena Owusu', email: 'abena@example.com', calendarEmail: 'not an address' },
    ]) {
      expect((await createAdmin(body)).status).toBe(400);
    }
    expectNothingCreated();
  });

  it('says the address is taken when another request created its account first', async () => {
    // The lookup finds no account, but by the time of the create there is one.
    racingCreate = true;

    const response = await createAdmin();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'That email address already has an account' });
    expectNothingCreated();
  });

  it('removes the account again if the email cannot be sent, so it can be tried again', async () => {
    const response = await createAdmin(NEW_ADMIN, 'efua', { ...env, EMAIL_PROVIDER: 'brevo' });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The email could not be sent, so the admin was not created',
    });
    expectNothingCreated();

    expect((await createAdmin()).status).toBe(201);
  });
});

describe('the set-password link', () => {
  async function linkFor(): Promise<URL> {
    await createAdmin();
    return sentLinks()[0];
  }

  it('says which account it is for, then sets the password once', async () => {
    const link = await linkFor();

    expect(await (await useLink(link)).json()).toEqual({ email: 'abena@example.com' });
    const set = await useLink(link, 'a new password');
    expect(await set.json()).toEqual({ reset: true });
    expect(accounts.get('new1')).toMatchObject({ password: 'a new password' });

    const again = await useLink(link, 'another password');
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({
      error: 'This link is not valid or has already been used',
    });
  });

  it('needs a long enough password', async () => {
    const link = await linkFor();
    const random = accounts.get('new1')!.password;
    const response = await useLink(link, 'x'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(response.status).toBe(400);
    expect(accounts.get('new1')!.password).toBe(random);
  });

  it('does not work as a password reset link, nor a reset link as this one', async () => {
    const link = await linkFor();
    expect((await useLink(link, 'a new password', '/v1/password/reset')).status).toBe(400);

    await post('/v1/password/reset-link', { email: 'abena@example.com' }, null);
    const reset = (log.mock.calls as [string, { text?: string }][])
      .map(([, email]) => /http\S+reset-password\S+/.exec(email?.text ?? ''))
      .find((match) => match !== null)!;
    expect((await useLink(new URL(reset[0]), 'a new password')).status).toBe(400);
  });

  it('expires after 72 hours', async () => {
    const link = await linkFor();
    vi.useFakeTimers({ now: Date.now() + (SET_PASSWORD_LINK_HOURS * 3600 + 1) * 1000 });
    try {
      expect((await useLink(link, 'a new password')).status).toBe(410);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('admin sign-in methods (FR-1.9)', () => {
  const me = (uid: string, provider: string) =>
    worker.fetch(
      new Request('https://api.test/v1/me', {
        headers: signedIn(uid, { firebase: { sign_in_provider: provider } }),
      }) as Request<unknown, IncomingRequestCfProperties>,
      env,
    );

  it('refuses an admin who signed in any way but email and password', async () => {
    for (const uid of ['efua', 'kofi']) {
      const response = await me(uid, 'google.com');
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Admins log in with email and password' });
      expect((await me(uid, 'password')).status).toBe(200);
    }
  });

  it('lets a member sign in another way', async () => {
    expect((await me('ama', 'google.com')).status).toBe(200);
  });
});
