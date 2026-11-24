import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Accounts } from './accounts';
import { Api, ApiError } from './api';

/** A sign-in's limits, as GET /v1/me gives them (worker/src/sessions.ts). */
export interface SessionInfo {
  /** How long the sign-in may go without activity. */
  idleSeconds: number;
  /** When it ends whatever its activity, in milliseconds since 1970, or null. */
  expiresAt: number | null;
}

/** What GET /v1/me answers. */
export interface Me {
  uid: string;
  role: string;
  session: SessionInfo;
}

export const SESSION_EXPIRED = 'Your session has expired. Please log in again.';

/** How often to look for an expired session. */
export const CHECK_MS = 30_000;

/**
 * The longest the Worker goes without hearing of activity: a tenth of the idle limit, so 3 minutes
 * for an admin, and at most 5 minutes. An admin who closes the app straight after using it can
 * therefore be logged out up to that much early.
 */
export function heartbeatMs(info: SessionInfo): number {
  return Math.min(5 * 60_000, (info.idleSeconds * 1000) / 10);
}

/** Until the Worker has answered: the longest limits any role has, which it then narrows. */
const UNKNOWN_LIMITS: SessionInfo = { idleSeconds: 30 * 24 * 3600, expiresAt: null };

/** Followed by the account's user ID. */
const STORAGE_KEY = 'nkabom.session';
const ACTIVITY_WRITE_MS = 5_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * What the app keeps between visits for each account, shared by its tabs, so activity in one
 * counts for all.
 */
interface Stored extends SessionInfo {
  /** When someone last used the app on this device, in milliseconds since 1970. */
  lastActivity: number;
}

/**
 * Session expiry in the app (FR-1.10, NKB-205). The Worker and the Firestore rules enforce the
 * limits (worker/src/sessions.ts); this logs out on time so no one meets a refused page, and tells
 * the Worker of activity by calling GET /v1/me while the app is in use, which reading Firestore
 * alone does not. Activity is a tap, key press or scroll. Admins are logged out after 30 minutes
 * without one and 12 hours after logging in; members after 30 days without one.
 */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly accounts = inject(Accounts);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  /** Set when a session has just expired, for the login page to say so. */
  readonly expiredMessage = signal<string | null>(null);

  private timer: ReturnType<typeof setInterval> | undefined;
  /** Whose session this is: stored records are kept per account, as tabs can differ. */
  private uid: string | null = null;
  private lastPing = 0;
  private pinging: Promise<void> | undefined;
  private resuming: Promise<void> | undefined;
  private expiring = false;

  private readonly onActivity = () => this.recordActivity();
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') {
      void this.check();
    }
  };

  constructor() {
    // Any Worker call can find the session expired, not only the ones made here.
    this.api.onUnauthorized = () => {
      if (this.timer !== undefined) {
        void this.expire();
      }
    };
  }

  /**
   * After logging in: calls GET /v1/me, which creates a first account's users record and starts
   * the sign-in's activity, and starts watching. Throws the ApiError if the Worker refuses.
   */
  async start(): Promise<Me> {
    const me = await this.api.get<Me>('/v1/me');
    this.uid = me.uid;
    this.lastPing = Date.now();
    this.save({ ...me.session, lastActivity: Date.now() });
    this.watch();
    return me;
  }

  /**
   * When the app opens with a saved sign-in, or a logged-in page opens (core/guards.ts): logs out
   * at once if the session expired meanwhile, and otherwise tells the Worker and starts watching.
   * Does nothing while already watching.
   */
  resume(): Promise<void> {
    if (this.timer !== undefined) {
      return Promise.resolve();
    }
    this.resuming ??= this.resumeNow().finally(() => (this.resuming = undefined));
    return this.resuming;
  }

  /** Logs out on request. */
  async logOut(): Promise<void> {
    await this.accounts.signOut();
    this.stop();
  }

  private async resumeNow(): Promise<void> {
    const user = await this.accounts.currentUser();
    if (!user?.emailVerified) {
      return;
    }
    this.uid = user.uid;
    const stored = this.load();
    if (stored && this.isOver(stored)) {
      await this.expire();
      return;
    }
    // Opening the app is activity.
    this.save({ ...(stored ?? UNKNOWN_LIMITS), lastActivity: Date.now() });
    this.watch();
    await this.ping();
  }

  private watch(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, this.onActivity, { capture: true, passive: true });
    }
    // Timers can sleep with the device, so look again as soon as the app is back on screen.
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const event of ACTIVITY_EVENTS) {
      document.removeEventListener(event, this.onActivity, { capture: true });
    }
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.uid) {
      localStorage.removeItem(this.storageKey(this.uid));
    }
    this.uid = null;
  }

  private recordActivity(): void {
    const stored = this.load();
    // An expired session stays expired: the check logs out rather than a tap reviving it.
    if (!stored || this.isOver(stored)) {
      void this.check();
      return;
    }
    // Scrolling fires many times a second, so write at most every few seconds.
    if (Date.now() - stored.lastActivity >= ACTIVITY_WRITE_MS) {
      this.save({ ...stored, lastActivity: Date.now() });
    }
    if (Date.now() - this.lastPing >= heartbeatMs(stored)) {
      void this.ping();
    }
  }

  private async check(): Promise<void> {
    const stored = this.load();
    // None while logged out in another tab: keep watching, as a login there brings it back.
    if (!stored) {
      return;
    }
    if (this.isOver(stored)) {
      await this.expire();
      return;
    }
    // Activity since the last call that the Worker has not heard of yet.
    if (stored.lastActivity > this.lastPing && Date.now() - this.lastPing >= heartbeatMs(stored)) {
      await this.ping();
    }
  }

  private ping(): Promise<void> {
    this.pinging ??= this.callWorker().finally(() => (this.pinging = undefined));
    return this.pinging;
  }

  private async callWorker(): Promise<void> {
    this.lastPing = Date.now();
    try {
      const { session } = await this.api.get<Me>('/v1/me');
      const stored = this.load();
      if (stored) {
        this.save({ ...session, lastActivity: stored.lastActivity });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.expire();
      }
      // Offline, or the Worker failing: the checks here carry on, and the next call tries again.
    }
  }

  private async expire(): Promise<void> {
    if (this.expiring) {
      return;
    }
    this.expiring = true;
    try {
      await this.accounts.signOut();
    } catch {
      // Still signed in, so keep watching: the next check tries again.
      return;
    } finally {
      this.expiring = false;
    }
    this.stop();
    this.expiredMessage.set(SESSION_EXPIRED);
    await this.router.navigateByUrl('/login');
  }

  private isOver(stored: Stored): boolean {
    const now = Date.now();
    return (
      now - stored.lastActivity > stored.idleSeconds * 1000 ||
      (stored.expiresAt !== null && now >= stored.expiresAt)
    );
  }

  private storageKey(uid: string): string {
    return `${STORAGE_KEY}.${uid}`;
  }

  private load(): Stored | null {
    if (!this.uid) {
      return null;
    }
    try {
      const value = JSON.parse(
        localStorage.getItem(this.storageKey(this.uid)) ?? 'null',
      ) as Stored | null;
      return value && typeof value.lastActivity === 'number' ? value : null;
    } catch {
      return null;
    }
  }

  private save(stored: Stored): void {
    if (this.uid) {
      localStorage.setItem(this.storageKey(this.uid), JSON.stringify(stored));
    }
  }
}
