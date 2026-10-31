import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import worker from './index';
import {
  claims,
  emulatorEnv,
  signingKey,
  signToken,
  stagingEnv,
  unsignedToken,
} from './test-helpers';

const ORIGIN = 'https://nkabom-staging.web.app';
const DOCUMENTS =
  'https://firestore.googleapis.com/v1/projects/nkabom-staging/databases/(default)/documents';
const USERS_DOC = `${DOCUMENTS}/users/ama`;
const COMMIT = `${DOCUMENTS}:commit`;

let google: Awaited<ReturnType<typeof signingKey>>;
let serviceAccount: string;

beforeAll(async () => {
  google = await signingKey('google-1');
  const account = await signingKey('service-account');
  serviceAccount = JSON.stringify({
    client_email: 'firebase-adminsdk@nkabom-staging.iam.gserviceaccount.com',
    private_key: account.pkcs8,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Stands in for Google: its token keys, the OAuth token exchange and Firestore.
function mockGoogle(
  usersDoc: Response = Response.json({ fields: { role: { stringValue: 'member' } } }),
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://www.googleapis.com/service_accounts/')) {
      return Response.json({ keys: [google.jwk] });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'google-access-token', expires_in: 3600 });
    }
    if (url === USERS_DOC) {
      return usersDoc.clone();
    }
    if (url === COMMIT) {
      return Response.json({ commitTime: '2026-10-23T10:00:00Z' });
    }
    return new Response('unexpected request', { status: 500 });
  });
}

function call(
  path: string,
  init: RequestInit = {},
  env = stagingEnv({ GOOGLE_SERVICE_ACCOUNT: serviceAccount }),
) {
  // The Workers types expect an incoming request, which carries Cloudflare's cf properties.
  const request = new Request(`https://api.test${path}`, init) as Request<
    unknown,
    IncomingRequestCfProperties
  >;
  return worker.fetch(request, env);
}

describe('GET /v1/me', () => {
  it('rejects a missing token', async () => {
    const response = await call('/v1/me');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in required' });
  });

  it('rejects a forged token', async () => {
    mockGoogle();
    const attacker = await signingKey('google-1');
    const token = await signToken(attacker.privateKey, 'google-1', claims());

    const response = await call('/v1/me', { headers: { Authorization: `Bearer ${token}` } });

    expect(response.status).toBe(401);
  });

  it('reads the caller’s users record from Firestore with a valid token', async () => {
    const fetch = mockGoogle();
    const token = await signToken(google.privateKey, 'google-1', claims());

    const response = await call('/v1/me', { headers: { Authorization: `Bearer ${token}` } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uid: 'ama', role: 'member' });
    const firestoreCall = fetch.mock.calls.find(([url]) => String(url) === USERS_DOC);
    expect(firestoreCall?.[1]?.headers).toEqual({ Authorization: 'Bearer google-access-token' });
  });

  it('creates the users record on a new account’s first call', async () => {
    const fetch = mockGoogle(new Response('{}', { status: 404 }));
    const token = await signToken(google.privateKey, 'google-1', claims());

    const response = await call('/v1/me', { headers: { Authorization: `Bearer ${token}` } });

    expect(await response.json()).toEqual({ uid: 'ama', role: 'member' });
    const [, init] = fetch.mock.calls.find(([url]) => String(url).endsWith(':commit'))!;
    expect(JSON.parse(String(init?.body))).toEqual({
      writes: [
        {
          update: {
            name: 'projects/nkabom-staging/databases/(default)/documents/users/ama',
            fields: {
              role: { stringValue: 'member' },
              email: { stringValue: 'ama@example.com' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
    });
  });

  it('answers 500 without details when Firestore fails', async () => {
    mockGoogle(new Response('quota', { status: 429 }));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const token = await signToken(google.privateKey, 'google-1', claims());

    const response = await call('/v1/me', { headers: { Authorization: `Bearer ${token}` } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Something went wrong' });
    expect(logError).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({ path: '/v1/me' }),
    );
  });

  it('uses the emulators locally, with the owner token', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).endsWith('accounts:lookup')
          ? Response.json({ users: [{ localId: 'ama' }] })
          : Response.json({ fields: { role: { stringValue: 'admin' } } }),
      );
    const token = unsignedToken(claims('demo-nkabom'));

    const response = await call(
      '/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      emulatorEnv(),
    );

    expect(await response.json()).toEqual({ uid: 'ama', role: 'admin' });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/projects/demo-nkabom/databases/(default)/documents/users/ama',
      { headers: { Authorization: 'Bearer owner' } },
    );
  });

  it('only allows GET', async () => {
    const response = await call('/v1/me', { method: 'POST' });

    expect(response.status).toBe(405);
  });
});

describe('routing', () => {
  it('answers the health check without a sign-in', async () => {
    const response = await call('/health');

    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers 404 for unknown paths', async () => {
    const response = await call('/nope');

    expect(response.status).toBe(404);
  });
});

describe('CORS', () => {
  // Staging's origins, preview channels included, as in wrangler.jsonc.
  const previewEnv = () =>
    stagingEnv({
      ALLOWED_ORIGINS:
        'https://nkabom-staging.web.app,https://nkabom-staging.firebaseapp.com,https://nkabom-staging--*.web.app',
    });

  it('allows the app’s origin', async () => {
    const response = await call('/health', { headers: { Origin: ORIGIN } });

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it.each([
    'https://nkabom-staging--pr12-a1b2c3d4.web.app',
    'https://nkabom-staging--main-0f9e8d7c.web.app',
  ])('allows a staging preview channel, %s', async (origin) => {
    const response = await call('/health', { headers: { Origin: origin } }, previewEnv());

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });

  it.each([
    'https://nkabom-staging--pr12.web.app.evil.example',
    'https://evil.example/https://nkabom-staging--pr12.web.app',
    'https://nkabom-staging--.web.app',
    'https://nkabom-staging--pr12_x.web.app',
    'https://nkabom-staging--PR12.web.app',
    'http://nkabom-staging--pr12.web.app',
    'https://nkabom-prod--pr12.web.app',
    'https://nkabom-stagingxweb.app',
  ])('refuses %s, which only looks like a preview channel', async (origin) => {
    const response = await call('/health', { headers: { Origin: origin } }, previewEnv());

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('gives other origins no CORS headers', async () => {
    const response = await call('/health', { headers: { Origin: 'https://evil.example' } });

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers a preflight from the app', async () => {
    const response = await call('/v1/me', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization, Content-Type',
    );
  });

  it('refuses a preflight from another origin', async () => {
    const response = await call('/v1/me', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4200' },
    });

    expect(response.status).toBe(403);
  });

  it('adds CORS headers to errors too, so the app can read them', async () => {
    const response = await call('/v1/me', { headers: { Origin: ORIGIN } });

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});

describe('POST /v1/email/test', () => {
  // The emulators, with ama's users record holding the given role.
  function asRole(role: string) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('accounts:lookup')
        ? Response.json({ users: [{ localId: 'ama' }] })
        : Response.json({ fields: { role: { stringValue: role } } }),
    );
    return { Authorization: `Bearer ${unsignedToken(claims('demo-nkabom'))}` };
  }

  it("sends an admin the test email at their sign-in's address", async () => {
    const headers = asRole('admin');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const response = await call(
      '/v1/email/test',
      { method: 'POST', headers },
      emulatorEnv({ EMAIL_PROVIDER: 'log' }),
    );

    expect(await response.json()).toEqual({ sentTo: 'ama@example.com' });
    expect(log).toHaveBeenCalledWith(
      'Email not sent (EMAIL_PROVIDER=log)',
      expect.objectContaining({
        to: 'ama@example.com',
        subject: 'Nkabom test notification',
        text: expect.stringContaining('http://localhost:4200/settings'),
      }),
    );
  });

  it('refuses members', async () => {
    const headers = asRole('member');

    const response = await call('/v1/email/test', { method: 'POST', headers }, emulatorEnv());

    expect(response.status).toBe(403);
  });

  it('answers 502 when the email cannot be sent', async () => {
    const headers = asRole('primaryAdmin');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Gmail without its secrets.
    const response = await call('/v1/email/test', { method: 'POST', headers }, emulatorEnv());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'The email could not be sent' });
    expect(logError).toHaveBeenCalledWith('Email send failed', expect.anything());
  });
});
