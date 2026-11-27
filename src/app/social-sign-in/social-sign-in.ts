import {
  Component,
  inject,
  InjectionToken,
  input,
  OnInit,
  PendingTasks,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { User } from 'firebase/auth';

import { environment } from '../../environments/environment';
import { Accounts, refreshSignIn, type SocialProvider } from '../core/accounts';
import { ApiError } from '../core/api';
import { authErrorMessage } from '../core/messages';
import { Session } from '../core/session';

/**
 * The Firebase projects whose Meta app lets members log in with Facebook (NKB-211). Until a
 * project's Meta app is published, which waits for the terms page (NKB-212; README, Setting up Facebook
 * login), only people with a role on it can, so production is left out and the button says so
 * instead. Add nkabom-prod here once its Meta app is published.
 */
const FACEBOOK_LOGIN_PROJECTS = ['demo-nkabom', 'nkabom-staging'];

/** Whether Facebook login is open in this build. */
export const FACEBOOK_LOGIN = new InjectionToken<boolean>('FACEBOOK_LOGIN', {
  providedIn: 'root',
  factory: () => FACEBOOK_LOGIN_PROJECTS.includes(environment.firebase.projectId ?? ''),
});

/** What the Facebook button says while Facebook login is not open. */
export const FACEBOOK_NOT_READY =
  'Facebook login is not available yet. Please continue with Google or your email address for now.';

const PROVIDER_NAMES: Record<SocialProvider, string> = { google: 'Google', facebook: 'Facebook' };

/** Firebase Auth's error codes for a Google or Facebook login, beside the shared ones (core/messages.ts). */
function socialErrors(provider: SocialProvider): Record<string, string> {
  const name = PROVIDER_NAMES[provider];
  return {
    'auth/popup-blocked': `Your browser blocked the ${name} window. Allow pop-ups for this site and try again.`,
    // Another account already uses the address: email and password, or the other provider.
    // Linking them is NKB-213.
    'auth/account-exists-with-different-credential':
      'This email address already has a Nkabom account. Log in the way you did before.',
    'auth/user-disabled': 'This account has been turned off. Please contact the executives.',
  };
}

/** Closing the provider's window, or opening a second one, is not an error to report. */
const CANCELLED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

/**
 * "Continue with Google" (NKB-210) and "Continue with Facebook" (NKB-211) for the login and
 * sign-up pages (FR-1.1). Logs in, creating the account on a first login, then starts the session
 * as the login page does, which creates the users record as a member, and goes to the home page.
 * The Worker counts a Facebook address as verified on that first call, so the sign-in is then
 * refreshed for the app and the rules to see it. Admins log in with email and password only
 * (FR-1.9): the Worker refuses an admin who uses either, and this signs them out again and says why.
 */
@Component({
  selector: 'app-social-sign-in',
  templateUrl: './social-sign-in.html',
  styleUrl: './social-sign-in.scss',
})
export class SocialSignIn implements OnInit {
  private readonly accounts = inject(Accounts);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly facebookLogin = inject(FACEBOOK_LOGIN);

  /** Whether the sign-in outlives the browser: the login page's "Remember me". */
  readonly remember = input(true);

  /** The provider a login is running with, while it runs. */
  protected readonly busy = signal<SocialProvider | null>(null);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // Back from the provider, on an iPhone Home Screen app (Accounts.logInWith). Tracked, so the
    // app is not stable (as tests wait for) until it has finished.
    const provider = this.accounts.pendingRedirect();
    if (provider) {
      void this.pendingTasks.run(() =>
        this.finish(provider, () => this.accounts.socialRedirectResult()),
      );
    }
  }

  protected continue(provider: SocialProvider): Promise<void> {
    if (provider === 'facebook' && !this.facebookLogin) {
      this.error.set(FACEBOOK_NOT_READY);
      return Promise.resolve();
    }
    return this.finish(provider, () => this.accounts.logInWith(provider, this.remember()));
  }

  private async finish(provider: SocialProvider, logIn: () => Promise<User | null>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(provider);
    this.error.set(null);
    let loggedIn = false;
    try {
      const user = await logIn();
      if (!user) {
        // Nothing to finish here, or the page is on its way to the provider.
        this.busy.set(null);
        return;
      }
      loggedIn = true;
      await this.session.start();
      if (!user.emailVerified) {
        // A Facebook address, which the Worker has just marked verified.
        await refreshSignIn(user);
      }
      await this.router.navigateByUrl('/home');
    } catch (error) {
      if (loggedIn) {
        // Logged in to Firebase, but the Worker refused, as for an admin, or the login could not
        // be finished, so log out again rather than leave a sign-in the app cannot use.
        await this.accounts.signOut().catch(() => undefined);
      }
      if (error instanceof ApiError) {
        this.error.set(error.message);
      } else {
        const code = (error as { code?: string } | null)?.code ?? '';
        this.error.set(
          CANCELLED.includes(code) ? null : authErrorMessage(error, socialErrors(provider)),
        );
      }
      this.busy.set(null);
    }
  }
}
