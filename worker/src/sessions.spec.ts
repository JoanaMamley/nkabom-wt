import { afterEach, describe, expect, it, vi } from 'vitest';

import type { User } from './auth';
import { HttpError } from './http';
import { ADMIN_LIMITS, MEMBER_LIMITS, SESSION_EXPIRED, touchSession } from './sessions';
import { emulatorEnv, mockEmulators } from './test-helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const env = emulatorEnv();
const SIGNED_IN = 1_790_000_000; // seconds
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function user(authTime = SIGNED_IN): User {
  return {
    uid: 'ama',
    name: null,
    email: 'ama@example.com',
    emailVerified: true,
    authTime,
    roleClaim: null,
  };
}

/** Milliseconds after the sign-in. */
function after(ms: number) {
  return SIGNED_IN * 1000 + ms;
}

function expired(promise: Promise<unknown>) {
  return expect(promise).rejects.toEqual(new HttpError(401, SESSION_EXPIRED));
}

describe('touchSession', () => {
  it('records a new sign-in and tells the app its limits', async () => {
    const { firestore } = mockEmulators();

    await expect(touchSession(env, user(), 'member', after(5_000))).resolves.toEqual({
      idleSeconds: MEMBER_LIMITS.idleSeconds,
      expiresAt: null,
    });
    await expect(touchSession(env, user(), 'admin', after(5_000))).resolves.toEqual({
      idleSeconds: ADMIN_LIMITS.idleSeconds,
      expiresAt: after(12 * HOUR),
    });

    expect(firestore.docs.get('sessions/ama')).toEqual({
      signIns: { [SIGNED_IN]: new Date(after(5_000)) },
    });
  });

  it('writes activity at most once a minute', async () => {
    const { firestore } = mockEmulators();

    await touchSession(env, user(), 'member', after(0));
    await touchSession(env, user(), 'member', after(30_000));
    await touchSession(env, user(), 'member', after(61_000));

    expect(firestore.commits).toHaveLength(2);
    expect(firestore.docs.get('sessions/ama')).toEqual({
      signIns: { [SIGNED_IN]: new Date(after(61_000)) },
    });
  });

  it('ends an idle admin sign-in sooner than an idle member one (FR-1.10)', async () => {
    mockEmulators();
    await touchSession(env, user(), 'member', after(0));

    // 31 minutes idle: too long for an admin, fine for a member.
    await expired(touchSession(env, user(), 'primaryAdmin', after(31 * MINUTE)));
    await expired(touchSession(env, user(), 'admin', after(31 * MINUTE)));
    await expect(touchSession(env, user(), 'member', after(31 * MINUTE))).resolves.toBeDefined();

    // 30 days and a minute idle ends a member's too.
    await expired(touchSession(env, user(), 'member', after(31 * MINUTE + 30 * DAY + MINUTE)));
  });

  it('keeps an active admin signed in, but not past 12 hours', async () => {
    mockEmulators();

    for (let at = 0; at < 12 * HOUR; at += 20 * MINUTE) {
      await touchSession(env, user(), 'admin', after(at));
    }
    await expired(touchSession(env, user(), 'admin', after(12 * HOUR)));
  });

  it('treats an unknown sign-in as idle since it began, so an expired one cannot restart', async () => {
    mockEmulators();

    await expect(touchSession(env, user(), 'admin', after(29 * MINUTE))).resolves.toBeDefined();
    await expired(touchSession(env, user(SIGNED_IN - 3600), 'admin', after(0)));
  });

  it('keeps each sign-in apart, and drops those idle past every limit', async () => {
    const { firestore } = mockEmulators();
    const stale = SIGNED_IN - 40 * 24 * 3600;
    firestore.docs.set('sessions/ama', {
      signIns: { [stale]: new Date(stale * 1000), [SIGNED_IN - 60]: new Date(after(-60_000)) },
    });

    await touchSession(env, user(), 'member', after(0));

    expect(firestore.docs.get('sessions/ama')).toEqual({
      signIns: {
        [SIGNED_IN - 60]: new Date(after(-60_000)),
        [SIGNED_IN]: new Date(after(0)),
      },
    });
  });
});
