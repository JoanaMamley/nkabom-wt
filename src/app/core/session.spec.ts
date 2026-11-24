import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Accounts } from './accounts';
import { Api, ApiError } from './api';
import { CHECK_MS, heartbeatMs, type Me, Session, SESSION_EXPIRED } from './session';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// The limits the Worker gives (worker/src/sessions.ts).
const MEMBER: Me = {
  uid: 'ama',
  role: 'member',
  session: { idleSeconds: 30 * 86400, expiresAt: null },
};
function admin(): Me {
  return {
    uid: 'efua',
    role: 'admin',
    session: { idleSeconds: 30 * 60, expiresAt: Date.now() + 12 * 60 * MINUTE },
  };
}

describe('Session', () => {
  const accounts = { currentUser: vi.fn(), signOut: vi.fn() };
  const api: { get: ReturnType<typeof vi.fn>; onUnauthorized?: () => void } = { get: vi.fn() };
  let navigate: ReturnType<typeof vi.spyOn>;
  let session: Session;

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-11-24T09:00:00Z') });
    localStorage.clear();
    accounts.currentUser.mockReset().mockResolvedValue({ uid: 'ama', emailVerified: true });
    accounts.signOut.mockReset().mockResolvedValue(undefined);
    api.get.mockReset().mockResolvedValue(MEMBER);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: accounts },
        { provide: Api, useValue: api },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    session = TestBed.inject(Session);
  });

  afterEach(async () => {
    await session.logOut();
    vi.useRealTimers();
  });

  /** Lets time pass with no one using the app. */
  async function idle(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  /** Lets time pass with a tap every few minutes. */
  async function active(ms: number) {
    for (let passed = 0; passed < ms; passed += 2 * MINUTE) {
      await idle(2 * MINUTE);
      document.dispatchEvent(new Event('pointerdown'));
    }
    await vi.runOnlyPendingTimersAsync();
  }

  function expectLoggedOut() {
    expect(accounts.signOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(session.expiredMessage()).toBe(SESSION_EXPIRED);
  }

  it('ends an idle admin session sooner than an idle member session (FR-1.10)', async () => {
    api.get.mockResolvedValue(admin());
    await session.start();
    await idle(31 * MINUTE);
    expectLoggedOut();

    accounts.signOut.mockClear();
    api.get.mockResolvedValue(MEMBER);
    await session.start();
    await idle(31 * MINUTE);
    expect(accounts.signOut).not.toHaveBeenCalled();
    await idle(30 * DAY);
    expectLoggedOut();
  });

  it('keeps an active admin logged in, telling the Worker, until 12 hours after login', async () => {
    api.get.mockResolvedValue(admin());
    await session.start();

    await active(11 * 60 * MINUTE);
    expect(accounts.signOut).not.toHaveBeenCalled();
    // At most one call to the Worker per heartbeat while in use.
    const calls = api.get.mock.calls.length;
    expect(calls).toBeGreaterThan(100);
    expect(calls).toBeLessThanOrEqual((11 * 60 * MINUTE) / heartbeatMs(admin().session) + 2);

    await active(60 * MINUTE + CHECK_MS);
    expectLoggedOut();
  });

  it('logs out when the Worker says the session has expired', async () => {
    await session.start();
    api.get.mockRejectedValue(new ApiError(401, SESSION_EXPIRED));

    await active(heartbeatMs(MEMBER.session) + MINUTE);

    expectLoggedOut();
  });

  it('keeps going offline, and expires by its own clock', async () => {
    api.get.mockResolvedValue(admin());
    await session.start();
    api.get.mockRejectedValue(new ApiError(0, 'Nkabom could not be reached.'));

    await active(20 * MINUTE);
    expect(accounts.signOut).not.toHaveBeenCalled();
    await idle(31 * MINUTE);
    expectLoggedOut();
  });

  describe('when the app opens with a saved sign-in', () => {
    it('logs out at once if the session expired while the app was closed', async () => {
      api.get.mockResolvedValue(admin());
      await session.start();
      // The app closes, and opens 40 minutes later.
      TestBed.resetTestingModule();
      vi.setSystemTime(Date.now() + 40 * MINUTE);
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: Accounts, useValue: accounts },
          { provide: Api, useValue: api },
        ],
      });
      navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      session = TestBed.inject(Session);
      accounts.currentUser.mockResolvedValue({ uid: 'efua', emailVerified: true });
      api.get.mockClear();

      await session.resume();

      expectLoggedOut();
      expect(api.get).not.toHaveBeenCalled();
    });

    it('tells the Worker and carries on otherwise', async () => {
      await session.resume();

      expect(api.get).toHaveBeenCalledWith('/v1/me');
      expect(accounts.signOut).not.toHaveBeenCalled();
    });

    it('does nothing when no one is logged in', async () => {
      accounts.currentUser.mockResolvedValue(null);

      await session.resume();
      await idle(60 * DAY);

      expect(api.get).not.toHaveBeenCalled();
      expect(accounts.signOut).not.toHaveBeenCalled();
    });
  });

  it('logs out when any other Worker call finds the session expired', async () => {
    await session.start();

    api.onUnauthorized!();
    await vi.advanceTimersByTimeAsync(0);

    expectLoggedOut();
  });

  it('keeps watching, and tries again, when logging out fails', async () => {
    api.get.mockResolvedValue(admin());
    await session.start();
    accounts.signOut.mockRejectedValueOnce(new Error('IndexedDB failed'));

    // The first check after 30 idle minutes.
    await idle(30 * MINUTE + CHECK_MS);
    expect(accounts.signOut).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(session.expiredMessage()).toBeNull();

    await idle(CHECK_MS);
    expectLoggedOut();
  });

  it('keeps each account’s record apart, as tabs can be logged in to different ones', async () => {
    api.get.mockResolvedValue(admin());
    await session.start();

    expect(Object.keys(localStorage)).toEqual(['nkabom.session.efua']);
  });

  it('picks up again after a logout and login in another tab', async () => {
    await session.start();
    const record = localStorage.getItem('nkabom.session.ama')!;
    localStorage.removeItem('nkabom.session.ama');
    await idle(10 * MINUTE);
    localStorage.setItem(
      'nkabom.session.ama',
      record.replace(/"lastActivity":\d+/, `"lastActivity":${Date.now()}`),
    );
    api.get.mockClear();

    await active(10 * MINUTE);

    expect(api.get).toHaveBeenCalled();
    expect(accounts.signOut).not.toHaveBeenCalled();
  });

  it('stops watching after logging out', async () => {
    await session.start();
    await session.logOut();
    accounts.signOut.mockClear();
    api.get.mockClear();

    await active(10 * MINUTE);
    await idle(31 * DAY);

    expect(api.get).not.toHaveBeenCalled();
    expect(accounts.signOut).not.toHaveBeenCalled();
  });
});
