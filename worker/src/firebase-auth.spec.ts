import { afterEach, describe, expect, it, vi } from 'vitest';

import { setRoleClaim } from './firebase-auth';
import { emulatorEnv } from './test-helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setRoleClaim', () => {
  it("stores the role as the account's only custom claim", async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ localId: 'efua' }));

    await setRoleClaim(emulatorEnv(), 'efua', 'primaryAdmin');

    const [url, init] = fetch.mock.calls[1];
    expect(String(url)).toBe(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-nkabom/accounts:update',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      localId: 'efua',
      customAttributes: '{"role":"primaryAdmin"}',
    });
  });

  it('keeps the other claims the account has', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('accounts:lookup')
        ? Response.json({
            users: [{ localId: 'efua', customAttributes: '{"role":"member","beta":true}' }],
          })
        : Response.json({}),
    );

    await setRoleClaim(emulatorEnv(), 'efua', 'admin');

    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).customAttributes).toBe(
      '{"role":"admin","beta":true}',
    );
  });

  it('fails when Firebase Auth refuses, so a role is never assumed to be set', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('accounts:lookup')
        ? Response.json({ users: [{ localId: 'efua' }] })
        : new Response('nope', { status: 400 }),
    );

    await expect(setRoleClaim(emulatorEnv(), 'efua', 'admin')).rejects.toThrow(/update failed/);
  });
});
