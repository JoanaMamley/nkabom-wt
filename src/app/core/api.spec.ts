import { TestBed } from '@angular/core/testing';

import { Api, API_TIMEOUT_MS, API_URL, ApiError } from './api';
import { FIREBASE_AUTH } from './firebase';

describe('Api', () => {
  let currentUser: { getIdToken: () => Promise<string> } | null;
  let fetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    currentUser = null;
    fetch = vi.spyOn(globalThis, 'fetch');
    TestBed.configureTestingModule({
      providers: [
        { provide: API_URL, useValue: 'https://api.test' },
        {
          provide: FIREBASE_AUTH,
          useValue: {
            get currentUser() {
              return currentUser;
            },
          },
        },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('posts JSON with the signed-in user’s ID token', async () => {
    currentUser = { getIdToken: async () => 'id-token' };
    fetch.mockResolvedValue(Response.json({ ok: true }));

    await expect(TestBed.inject(Api).post('/v1/thing', { a: 1 })).resolves.toEqual({ ok: true });

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/thing');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer id-token' });
  });

  it('patches and deletes, with the body only when there is one', async () => {
    fetch.mockImplementation(async () => Response.json({ ok: true }));
    const api = TestBed.inject(Api);

    await api.patch('/v1/thing/1', { a: 1 });
    await api.delete('/v1/thing/1');

    const [[, patch], [, remove]] = fetch.mock.calls as [string, RequestInit][];
    expect(patch).toMatchObject({ method: 'PATCH', body: '{"a":1}' });
    expect(remove.method).toBe('DELETE');
    expect(remove.body).toBeUndefined();
  });

  it('sends no sign-in when signed out', async () => {
    fetch.mockResolvedValue(Response.json({}));

    await TestBed.inject(Api).post('/v1/thing');

    expect((fetch.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('throws the Worker’s status and message on failure', async () => {
    fetch.mockResolvedValue(Response.json({ error: 'This link has expired' }, { status: 410 }));

    await expect(TestBed.inject(Api).post('/v1/thing')).rejects.toEqual(
      new ApiError(410, 'This link has expired'),
    );
  });

  it('gives up after the time limit, so a stalled request cannot leave a page waiting', async () => {
    vi.useFakeTimers();
    // Never answers, until aborted.
    fetch.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );

    const result = TestBed.inject(Api)
      .post('/v1/thing')
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);

    expect(await result).toEqual(
      new ApiError(0, 'Nkabom could not be reached. Check your connection and try again.'),
    );
    vi.useRealTimers();
  });

  it('counts a sign-in that cannot be renewed as unreachable', async () => {
    currentUser = { getIdToken: () => Promise.reject(new Error('auth/network-request-failed')) };

    const error = await TestBed.inject(Api)
      .post('/v1/thing')
      .catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws status 0 when the Worker cannot be reached', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await TestBed.inject(Api)
      .post('/v1/thing')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });
});
