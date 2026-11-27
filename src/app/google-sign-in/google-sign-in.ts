import { Component, inject, input, OnInit, PendingTasks, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { User } from 'firebase/auth';

import { Accounts } from '../core/accounts';
import { ApiError } from '../core/api';
import { authErrorMessage } from '../core/messages';
import { Session } from '../core/session';
import { PendingGoogleLink } from './pending-google-link';

// Firebase Auth's error codes for a Google login, beside the shared ones (core/messages.ts).
const GOOGLE_ERRORS: Record<string, string> = {
  'auth/popup-blocked':
    'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  // An email and password account already uses the address, and Google does not say it is
  // verified, so the two are not linked (NKB-213).
  'auth/account-exists-with-different-credential':
    'This email address already has a Nkabom account. Log in with your email address and password.',
  'auth/user-disabled': 'This account has been turned off. Please contact the executives.',
};

/** Closing the Google window, or opening a second one, is not an error to report. */
const CANCELLED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

/**
 * "Continue with Google" for the login and sign-up pages (FR-1.1, NKB-210). Logs in, creating the
 * account on a first login, then starts the session as the login page does, which creates the
 * users record as a member, and goes to the home page. Admins may use Google too, once it is
 * linked to their admin account (FR-1.9, NKB-213). If the Worker refuses, this signs them out
 * again and says why.
 * When an email and password account already has the address and Google says it is verified, it
 * keeps the Google sign-in and sends the member to log in with their password, after which the
 * login page adds Google to the account (FR-1.3, NKB-213).
 */
@Component({
  selector: 'app-google-sign-in',
  templateUrl: './google-sign-in.html',
  styleUrl: './google-sign-in.scss',
})
export class GoogleSignIn implements OnInit {
  private readonly accounts = inject(Accounts);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly pendingLink = inject(PendingGoogleLink);

  /** Whether the sign-in outlives the browser: the login page's "Remember me". */
  readonly remember = input(true);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // Back from Google, on an iPhone Home Screen app (Accounts.logInWithGoogle). Tracked, so the
    // app is not stable (as tests wait for) until it has finished.
    void this.pendingTasks.run(() => this.finish(() => this.accounts.googleRedirectResult()));
  }

  protected continue(): Promise<void> {
    return this.finish(() => this.accounts.logInWithGoogle(this.remember()));
  }

  private async finish(logIn: () => Promise<User | null>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      if (!(await logIn())) {
        // Nothing to finish here, or the page is on its way to Google.
        this.busy.set(false);
        return;
      }
      this.pendingLink.link.set(null);
      await this.session.start();
      await this.router.navigateByUrl('/home');
    } catch (error) {
      if (error instanceof ApiError) {
        // Logged in to Firebase, but the Worker refused, as for an admin, or could not be reached.
        await this.accounts.signOut().catch(() => undefined);
        this.error.set(error.message);
      } else if (await this.awaitPassword(error)) {
        this.error.set(null);
      } else {
        const code = (error as { code?: string } | null)?.code ?? '';
        this.error.set(CANCELLED.includes(code) ? null : authErrorMessage(error, GOOGLE_ERRORS));
      }
      this.busy.set(false);
    }
  }

  // NKB-213: keeps a verified Google sign-in that Firebase refused for an address with a password
  // account, and goes to the login page, which asks for the password and then links the two.
  private async awaitPassword(error: unknown): Promise<boolean> {
    const link = this.accounts.pendingGoogleLink(error);
    if (!link?.emailVerified) {
      return false;
    }
    this.pendingLink.link.set(link);
    if (!this.router.url.startsWith('/login')) {
      await this.router.navigateByUrl('/login');
    }
    return true;
  }
}
