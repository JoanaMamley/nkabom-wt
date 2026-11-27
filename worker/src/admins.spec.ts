import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_NAME_LENGTH } from './admins';
import type { Env } from './env';
import { FakeFirestore } from './fake-firestore';
import worker from './index';
import { MIN_PASSWORD_LENGTH, SET_PASSWORD_LINK_HOURS } from './password-reset';
import { RECENT_SIGN_IN_MINUTES, RECENT_SIGN_IN_REQUIRED } from './roles';
import { emulatorEnv, signedIn } from './test-helpers';

const env = emulatorEnv({ PHOTO_LINK_KEY: 'test-link-key', EMAIL_PROVIDER: 'log' });

interface FakeAccount {
  email?: string;
  password?: string;
  displayName?: string;
  emailVerified?: boolean;
  passwordUpdatedAt?: number;
  customAttributes?: string;
  disabled?: boolean;
  validSince?: string;
}

let firestore: FakeFirestore;
let accounts: Map<string, FakeAccount>;
let log: ReturnType<typeof vi.spyOn>;
let created = 0;
// Firebase refuses the next create, as when another request made the account first.
let racingCreate: boolean;
// Firebase fails to delete accounts.
let failDelete: boolean;

// Stands in for the Auth emulator, with its accounts, and the Firestore emulator. Efua is the
// Primary Admin, Kofi an admin and Ama a member. Like the emulator, setting a password moves
// passwordUpdatedAt and validSince on, and disableUser disables the account.
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
  failDelete = false;
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
      const account = accounts.get(body['localId'] as string);
      if (!account) {
        return Response.json({ error: { message: 'USER_NOT_FOUND' } }, { status: 400 });
      }
      const { disableUser, ...rest } = body;
      const moved =
        'password' in body
          ? {
              passwordUpdatedAt: account.passwordUpdatedAt! + 1,
              validSince: String(Math.floor(Date.now() / 1000)),
            }
          : {};
      Object.assign(
        account,
        rest,
        moved,
        disableUser === undefined ? {} : { disabled: disableUser },
      );
      return Response.json({ localId: body['localId'] });
    }
    if (url.endsWith('accounts:delete')) {
      if (failDelete || !accounts.delete(body['localId'] as string)) {
        const message = failDelete ? 'INTERNAL' : 'USER_NOT_FOUND';
        return Response.json({ error: { message } }, { status: failDelete ? 500 : 400 });
      }
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

function send(
  method: string,
  path: string,
  body: unknown,
  uid: string | null,
  testEnv: Env = env,
  extra = {},
) {
  const request = new Request(`https://api.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(uid ? signedIn(uid, extra) : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as Request<unknown, IncomingRequestCfProperties>;
  return worker.fetch(request, testEnv);
}

function post(path: string, body: unknown, uid: string | null, testEnv: Env = env, extra = {}) {
  return send('POST', path, body, uid, testEnv, extra);
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
        headers: signedIn(uid, {
          email: `${uid}@example.com`,
          firebase: { sign_in_provider: provider },
        }),
      }) as Request<unknown, IncomingRequestCfProperties>,
      env,
    );

  /** The emails written to the log with this subject. */
  const sent = (subject: string) =>
    (log.mock.calls as [string, { subject?: string; to?: string }][]).filter(
      ([, email]) => email?.subject === subject,
    );
  const GOOGLE_NOTICE = 'Google sign-in was used on your Nkabom admin account';
  const GOOGLE_ALERT = 'Google sign-in was used on an admin account';

  it('lets an admin sign in with email and password or Google (NKB-213)', async () => {
    for (const uid of ['efua', 'kofi']) {
      expect((await me(uid, 'password')).status).toBe(200);
      expect((await me(uid, 'google.com')).status).toBe(200);
    }
  });

  it('refuses an admin who signed in any other way', async () => {
    for (const provider of ['custom', 'anonymous', 'phone']) {
      const response = await me('kofi', provider);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Admins log in with email and password or Google',
      });
    }
  });

  it("tells an admin once, by email and in the audit log, of their account's first Google sign-in", async () => {
    await me('kofi', 'password');
    expect(sent(GOOGLE_NOTICE)).toEqual([]);

    await me('kofi', 'google.com');
    await me('kofi', 'google.com');

    expect(sent(GOOGLE_NOTICE).map(([, email]) => email.to)).toEqual(['kofi@example.com']);
    // The other Primary Admins are told too, since whoever holds Kofi's Google account may read
    // his email; Efua is the only one here.
    expect(sent(GOOGLE_ALERT).map(([, email]) => email.to)).toEqual(['efua@example.com']);
    expect(firestore.docs.get('users/kofi')!['googleSignInNoticeAt']).toBeTruthy();
    const entries = [...firestore.docs].filter(
      ([path, entry]) => path.startsWith('auditLog/') && entry['action'] === 'admin.googleSignIn',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0][1]).toMatchObject({ target: { type: 'admin', id: 'kofi' } });
  });

  it("tells a Primary Admin's own Google sign-in to the other Primary Admins, not to them", async () => {
    firestore.docs.set('users/esi', { role: 'primaryAdmin', email: 'esi@example.com' });
    firestore.docs.set('users/abla', {
      role: 'primaryAdmin',
      email: 'abla@example.com',
      status: 'deactivated',
    });

    await me('efua', 'google.com');

    expect(sent(GOOGLE_NOTICE).map(([, email]) => email.to)).toEqual(['efua@example.com']);
    expect(sent(GOOGLE_ALERT).map(([, email]) => email.to)).toEqual(['esi@example.com']);
  });

  it('does not stop the sign-in when the notice cannot be sent', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(init?.body ?? '').includes('googleSignInNoticeAt')
        ? new Response('nope', { status: 500 })
        : original(input, init),
    );
    expect((await me('kofi', 'google.com')).status).toBe(200);
    expect(error).toHaveBeenCalledWith('Google sign-in notice not sent', expect.anything());
  });

  it('lets a member sign in with Google without any notice', async () => {
    expect((await me('ama', 'google.com')).status).toBe(200);
    expect(sent(GOOGLE_NOTICE)).toEqual([]);
    expect(sent(GOOGLE_ALERT)).toEqual([]);
  });
});

// NKB-213: managing admins needs a sign-in from the last few minutes.
describe('recent sign-in for managing admins', () => {
  const longAgo = { auth_time: Math.floor(Date.now() / 1000) - RECENT_SIGN_IN_MINUTES * 60 - 5 };

  it('refuses each change from an older sign-in, with a code the app acts on', async () => {
    const calls = [
      () => post('/v1/admins', NEW_ADMIN, 'efua', env, longAgo),
      () => send('PATCH', '/v1/admins/kofi', { role: 'primaryAdmin' }, 'efua', env, longAgo),
      () => post('/v1/admins/kofi/deactivate', {}, 'efua', env, longAgo),
      () => post('/v1/admins/kofi/reactivate', {}, 'efua', env, longAgo),
      () => send('DELETE', '/v1/admins/kofi', undefined, 'efua', env, longAgo),
    ];
    for (const call of calls) {
      const response = await call();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: RECENT_SIGN_IN_REQUIRED });
    }
    expect(firestore.docs.get('users/kofi')).toMatchObject({ role: 'admin' });
    expect(accounts.has('kofi')).toBe(true);
  });

  it('still lists the admins from an older sign-in', async () => {
    expect((await send('GET', '/v1/admins', undefined, 'efua', env, longAgo)).status).toBe(200);
  });

  it('tells a member they cannot, rather than asking them to sign in again', async () => {
    const response = await post('/v1/admins', NEW_ADMIN, 'ama', env, longAgo);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only a Primary Admin can do this' });
  });
});

// NKB-209. Efua and Esi are Primary Admins, Kofi an admin and Ama a member.
describe('managing admins (FR-1.6, FR-1.7)', () => {
  beforeEach(() => {
    firestore.docs.set('users/efua', {
      role: 'primaryAdmin',
      email: 'efua@example.com',
      name: 'Efua Asante',
    });
    firestore.docs.set('users/esi', {
      role: 'primaryAdmin',
      email: 'esi@example.com',
      name: 'Esi',
    });
    firestore.docs.set('users/kofi', {
      role: 'admin',
      email: 'kofi@example.com',
      name: 'Kofi Boateng',
      calendarEmail: 'kofi@gmail.com',
    });
    accounts.set('esi', { email: 'esi@example.com', emailVerified: true, passwordUpdatedAt: 1 });
  });

  const list = (uid = 'efua') => send('GET', '/v1/admins', undefined, uid);
  const setRole = (target: string, role: unknown, uid = 'efua') =>
    send('PATCH', `/v1/admins/${target}`, { role }, uid);
  const deactivate = (target: string, uid = 'efua') =>
    post(`/v1/admins/${target}/deactivate`, {}, uid);
  const reactivate = (target: string, uid = 'efua') =>
    post(`/v1/admins/${target}/reactivate`, {}, uid);
  const remove = (target: string, uid = 'efua') =>
    send('DELETE', `/v1/admins/${target}`, undefined, uid);
  // A call from a sign-in that began a minute ago, before anything a test does.
  const me = (uid: string) =>
    send('GET', '/v1/me', undefined, uid, env, { auth_time: Math.floor(Date.now() / 1000) - 60 });
  const actions = () => auditEntries().map(([, entry]) => entry['action']);

  describe('GET /v1/admins', () => {
    it('lists every admin by name, marking the caller', async () => {
      firestore.docs.set('users/yaw', {
        role: 'admin',
        email: 'yaw@example.com',
        name: 'Akua',
        status: 'deactivated',
      });

      const response = await list();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        admins: [
          {
            uid: 'yaw',
            name: 'Akua',
            email: 'yaw@example.com',
            calendarEmail: null,
            role: 'admin',
            status: 'deactivated',
            self: false,
          },
          {
            uid: 'efua',
            name: 'Efua Asante',
            email: 'efua@example.com',
            calendarEmail: null,
            role: 'primaryAdmin',
            status: 'active',
            self: true,
          },
          expect.objectContaining({ uid: 'esi', role: 'primaryAdmin' }),
          expect.objectContaining({ uid: 'kofi', calendarEmail: 'kofi@gmail.com' }),
        ],
      });
    });

    it('lists an admin once even if their role changes between the two queries', async () => {
      const fake = vi.mocked(globalThis.fetch).getMockImplementation()!;
      let queries = 0;
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        if (String(input).endsWith(':runQuery') && ++queries === 2) {
          // Kofi is promoted after the query for admins has found him.
          firestore.docs.set('users/kofi', {
            ...firestore.docs.get('users/kofi'),
            role: 'primaryAdmin',
          });
        }
        return fake(input, init);
      });

      const { admins } = (await (await list()).json()) as { admins: { uid: string }[] };

      expect(admins.filter(({ uid }) => uid === 'kofi')).toHaveLength(1);
    });

    it('is for Primary Admins only', async () => {
      expect((await list('kofi')).status).toBe(403);
      expect((await list('ama')).status).toBe(403);
    });
  });

  describe('PATCH /v1/admins/{uid}', () => {
    it('promotes an admin to Primary Admin, with the claim and an audit entry', async () => {
      const response = await setRole('kofi', 'primaryAdmin');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ uid: 'kofi', role: 'primaryAdmin' });
      expect(firestore.docs.get('users/kofi')?.['role']).toBe('primaryAdmin');
      expect(JSON.parse(accounts.get('kofi')!.customAttributes!)).toEqual({
        role: 'primaryAdmin',
      });
      expect(auditEntries().map(([, entry]) => entry)).toMatchObject([
        {
          actor: { uid: 'efua' },
          action: 'admin.roleChange',
          target: { type: 'admin', id: 'kofi' },
          details: { from: 'admin', to: 'primaryAdmin', email: 'kofi@example.com' },
        },
      ]);
      // Kofi can now manage admins.
      expect((await list('kofi')).status).toBe(200);
    });

    it('demotes another Primary Admin, who loses the right to manage admins at once', async () => {
      expect((await setRole('esi', 'admin')).status).toBe(200);

      expect(firestore.docs.get('users/esi')?.['role']).toBe('admin');
      expect((await list('esi')).status).toBe(403);
      expect(actions()).toEqual(['admin.roleChange']);
    });

    it('changes nothing when the admin already has the role', async () => {
      expect((await setRole('kofi', 'admin')).status).toBe(200);
      expect(auditEntries()).toEqual([]);
    });

    it('never lets the last Primary Admin be demoted, as no one can demote themselves', async () => {
      firestore.docs.delete('users/esi');

      const response = await setRole('efua', 'admin');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'You cannot change your own admin account. Ask another Primary Admin.',
      });
      expect(firestore.docs.get('users/efua')?.['role']).toBe('primaryAdmin');
    });

    it('leaves one Primary Admin when two demote each other at once', async () => {
      // Esi's request passes the role check, then, before her transaction reads the records,
      // Efua's demotion of her commits.
      const fake = vi.mocked(globalThis.fetch).getMockImplementation()!;
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        if (String(input).endsWith(':batchGet') && String(init?.body).includes('users/efua')) {
          vi.mocked(globalThis.fetch).mockImplementation(fake);
          expect((await setRole('esi', 'admin', 'efua')).status).toBe(200);
        }
        return fake(input, init);
      });

      const response = await setRole('efua', 'admin', 'esi');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Only a Primary Admin can do this' });
      expect(firestore.docs.get('users/efua')?.['role']).toBe('primaryAdmin');
      expect(firestore.docs.get('users/esi')?.['role']).toBe('admin');
      expect(actions()).toEqual(['admin.roleChange']);
    });

    it('accepts only the admin roles, and only for admins', async () => {
      expect((await setRole('kofi', 'member')).status).toBe(400);
      expect((await setRole('kofi', undefined)).status).toBe(400);
      expect((await setRole('ama', 'primaryAdmin')).status).toBe(404);
      expect((await setRole('nobody', 'primaryAdmin')).status).toBe(404);
      expect((await setRole('not-a-uid', 'primaryAdmin')).status).toBe(404);
      expect(firestore.docs.get('users/ama')?.['role']).toBe('member');
    });

    it('is for Primary Admins only', async () => {
      expect((await setRole('esi', 'admin', 'kofi')).status).toBe(403);
      expect((await setRole('kofi', 'primaryAdmin', 'ama')).status).toBe(403);
      expect(auditEntries()).toEqual([]);
    });

    it('refuses to change a deactivated admin’s role', async () => {
      await deactivate('kofi');

      const response = await setRole('kofi', 'primaryAdmin');

      expect(response.status).toBe(409);
      expect(firestore.docs.get('users/kofi')?.['role']).toBe('admin');
    });
  });

  describe('POST /v1/admins/{uid}/deactivate', () => {
    it('ends the admin’s sessions at once and disables their account', async () => {
      firestore.docs.set('sessions/kofi', { signIns: {} });
      expect((await me('kofi')).status).toBe(200);

      const response = await deactivate('kofi');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ uid: 'kofi', status: 'deactivated' });
      expect(firestore.docs.get('users/kofi')).toMatchObject({
        role: 'admin',
        status: 'deactivated',
        deactivatedAt: firestore.now,
      });
      expect(firestore.docs.has('sessions/kofi')).toBe(false);
      expect(accounts.get('kofi')).toMatchObject({ disabled: true });
      expect(actions()).toEqual(['admin.deactivate']);

      const after = await me('kofi');
      expect(after.status).toBe(401);
    });

    it('refuses the admin by their users record alone, if their account could not be disabled', async () => {
      // As if the call to Firebase had failed: the record says deactivated, the account does not.
      firestore.docs.set('users/kofi', { role: 'admin', status: 'deactivated' });

      const response = await me('kofi');

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'This account has been deactivated' });
    });

    it('refuses a sign-in revoked by Firebase alone, if the record were not changed', async () => {
      accounts.get('kofi')!.validSince = String(Math.floor(Date.now() / 1000));

      expect((await me('kofi')).status).toBe(401);
    });

    it('can be repeated, which disables the account again without a second audit entry', async () => {
      await deactivate('kofi');
      accounts.get('kofi')!.disabled = false;

      expect((await deactivate('kofi')).status).toBe(200);

      expect(accounts.get('kofi')).toMatchObject({ disabled: true });
      expect(actions()).toEqual(['admin.deactivate']);
    });

    it('succeeds for an admin whose account a stalled deletion already removed', async () => {
      accounts.delete('kofi');

      expect((await deactivate('kofi')).status).toBe(200);
      expect(firestore.docs.get('users/kofi')?.['status']).toBe('deactivated');
    });

    it('can deactivate another Primary Admin, but not the caller', async () => {
      expect((await deactivate('esi')).status).toBe(200);
      expect((await deactivate('efua')).status).toBe(403);
      expect(firestore.docs.get('users/efua')?.['status']).toBeUndefined();
    });

    it('is for Primary Admins only, and only for admins', async () => {
      expect((await deactivate('esi', 'kofi')).status).toBe(403);
      expect((await deactivate('ama')).status).toBe(404);
      expect(accounts.get('ama')?.disabled).toBeUndefined();
      expect(auditEntries()).toEqual([]);
    });

    it('stops a deactivated Primary Admin from managing admins', async () => {
      await deactivate('esi');

      expect((await deactivate('kofi', 'esi')).status).toBe(401);
      expect(firestore.docs.get('users/kofi')?.['status']).toBeUndefined();
    });
  });

  describe('POST /v1/admins/{uid}/reactivate', () => {
    it('lets a deactivated admin log in again, keeping their account and role', async () => {
      await deactivate('kofi');

      const response = await reactivate('kofi');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ uid: 'kofi', status: 'active' });
      expect(firestore.docs.get('users/kofi')).toMatchObject({
        role: 'admin',
        status: 'active',
        reactivatedAt: firestore.now,
        calendarEmail: 'kofi@gmail.com',
      });
      expect(accounts.get('kofi')).toMatchObject({ disabled: false, passwordUpdatedAt: 1 });
      expect(auditEntries().map(([, entry]) => entry)).toMatchObject([
        { action: 'admin.deactivate' },
        {
          actor: { uid: 'efua' },
          action: 'admin.reactivate',
          target: { type: 'admin', id: 'kofi' },
          details: { email: 'kofi@example.com' },
        },
      ]);
      // A new sign-in works; the one from before the deactivation stays revoked.
      expect((await send('GET', '/v1/me', undefined, 'kofi')).status).toBe(200);
      expect((await me('kofi')).status).toBe(401);
    });

    it('keeps the admin out if their account cannot be enabled, and can be tried again', async () => {
      await deactivate('kofi');
      const update = vi.mocked(globalThis.fetch).getMockImplementation()!;
      const failing = vi
        .mocked(globalThis.fetch)
        .mockImplementation(async (input, init) =>
          String(input).endsWith('accounts:update')
            ? Response.json({ error: { message: 'INTERNAL' } }, { status: 500 })
            : update(input, init),
        );

      const response = await reactivate('kofi');

      expect(response.status).toBe(502);
      expect(firestore.docs.get('users/kofi')?.['status']).toBe('active');
      expect((await send('GET', '/v1/me', undefined, 'kofi')).status).toBe(401);

      failing.mockImplementation(update);
      expect((await reactivate('kofi')).status).toBe(200);
      expect(accounts.get('kofi')?.disabled).toBe(false);
      expect(actions()).toEqual(['admin.deactivate', 'admin.reactivate']);
    });

    it('refuses an admin whose account a stalled deletion already removed', async () => {
      await deactivate('kofi');
      accounts.delete('kofi');

      const response = await reactivate('kofi');

      expect(response.status).toBe(409);
      expect(firestore.docs.get('users/kofi')?.['status']).toBe('deactivated');
      expect((await remove('kofi')).status).toBe(200);
    });

    it('changes nothing for an active admin', async () => {
      expect((await reactivate('kofi')).status).toBe(200);
      expect(firestore.docs.get('users/kofi')?.['status']).toBeUndefined();
      expect(auditEntries()).toEqual([]);
    });

    it('lets a reactivated admin’s role be changed again', async () => {
      await deactivate('kofi');
      await reactivate('kofi');

      expect((await setRole('kofi', 'primaryAdmin')).status).toBe(200);
    });

    it('is for Primary Admins only, never on the caller, and only for admins', async () => {
      await deactivate('esi');
      expect((await reactivate('esi', 'kofi')).status).toBe(403);
      expect((await reactivate('efua')).status).toBe(403);
      expect((await reactivate('ama')).status).toBe(404);
      expect(firestore.docs.get('users/esi')?.['status']).toBe('deactivated');
      expect(accounts.get('esi')?.disabled).toBe(true);
    });
  });

  describe('DELETE /v1/admins/{uid}', () => {
    it('deletes the account and its records, keeping the audit entry', async () => {
      for (const collection of ['sessions', 'emailVerifications', 'passwordResets']) {
        firestore.docs.set(`${collection}/kofi`, { kept: false });
      }

      const response = await remove('kofi');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ uid: 'kofi', deleted: true });
      expect(accounts.has('kofi')).toBe(false);
      for (const collection of ['users', 'sessions', 'emailVerifications', 'passwordResets']) {
        expect(firestore.docs.has(`${collection}/kofi`)).toBe(false);
      }
      expect(auditEntries().map(([, entry]) => entry)).toMatchObject([
        {
          actor: { uid: 'efua' },
          action: 'admin.delete',
          target: { type: 'admin', id: 'kofi' },
          details: { email: 'kofi@example.com' },
        },
      ]);
    });

    it('deletes another Primary Admin, but never the caller, so one always remains', async () => {
      expect((await remove('esi')).status).toBe(200);

      const response = await remove('efua');

      expect(response.status).toBe(403);
      expect(accounts.has('efua')).toBe(true);
      expect(firestore.docs.get('users/efua')?.['role']).toBe('primaryAdmin');
    });

    it('leaves the admin deactivated if their account cannot be deleted, and can be tried again', async () => {
      failDelete = true;

      const response = await remove('kofi');

      expect(response.status).toBe(502);
      expect(firestore.docs.get('users/kofi')?.['status']).toBe('deactivated');
      expect((await me('kofi')).status).toBe(401);
      expect(auditEntries()).toEqual([]);

      failDelete = false;
      expect((await remove('kofi')).status).toBe(200);
      expect(accounts.has('kofi')).toBe(false);
      expect(firestore.docs.has('users/kofi')).toBe(false);
    });

    it('finishes a deletion whose account is already gone', async () => {
      accounts.delete('kofi');

      expect((await remove('kofi')).status).toBe(200);
      expect(firestore.docs.has('users/kofi')).toBe(false);
    });

    it('deletes a deactivated admin', async () => {
      await deactivate('kofi');

      expect((await remove('kofi')).status).toBe(200);
      expect(actions()).toEqual(['admin.deactivate', 'admin.delete']);
    });

    it('is for Primary Admins only, and only for admins', async () => {
      expect((await remove('esi', 'kofi')).status).toBe(403);
      expect((await remove('ama')).status).toBe(404);
      expect(accounts.has('ama')).toBe(true);
      expect(firestore.docs.has('users/ama')).toBe(true);
    });
  });

  it('answers 405 to other methods', async () => {
    expect((await send('PUT', '/v1/admins/kofi', {}, 'efua')).status).toBe(405);
    expect((await send('GET', '/v1/admins/kofi/deactivate', undefined, 'efua')).status).toBe(405);
    expect((await send('GET', '/v1/admins/kofi/reactivate', undefined, 'efua')).status).toBe(405);
    expect((await post('/v1/admins/kofi/promote', {}, 'efua')).status).toBe(404);
  });
});

// NKB-203, NKB-209: a new password ends the account's other sign-ins at once.
describe('sign-ins after a password reset', () => {
  it('refuses a sign-in from before the reset', async () => {
    const earlier = { auth_time: Math.floor(Date.now() / 1000) - 60 };
    const me = () => send('GET', '/v1/me', undefined, 'ama', env, earlier);
    expect((await me()).status).toBe(200);

    await post('/v1/password/reset-link', { email: 'ama@example.com' }, null);
    const reset = (log.mock.calls as [string, { text?: string }][])
      .map(([, email]) => /http\S+reset-password\S+/.exec(email?.text ?? ''))
      .find((match) => match !== null)!;
    expect((await useLink(new URL(reset[0]), 'a new password', '/v1/password/reset')).status).toBe(
      200,
    );

    expect((await me()).status).toBe(401);
    expect((await send('GET', '/v1/me', undefined, 'ama')).status).toBe(200);
  });
});
