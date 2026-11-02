import { TestBed } from '@angular/core/testing';

import { Api, API_URL, ApiError } from './api';
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

  it('throws status 0 when the Worker cannot be reached', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await TestBed.inject(Api)
      .post('/v1/thing')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });
});
