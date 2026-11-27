import { Component, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { User } from 'firebase/auth';

import { AuthLayout } from '../auth-layout/auth-layout';
import { Accounts } from '../core/accounts';
import { ApiError } from '../core/api';
import { authErrorMessage } from '../core/messages';
import { Session } from '../core/session';
import { GoogleSignIn } from '../google-sign-in/google-sign-in';
import { PendingGoogleLink } from '../google-sign-in/pending-google-link';
import { RevealPassword } from '../reveal-password/reveal-password';
import { Verification } from '../sign-up/verification';

// Firebase Auth's error codes for login, beside the shared ones (core/messages.ts). Wrong email and
// wrong password get the same answer, so the page does not reveal which addresses have accounts.
const LOGIN_ERRORS: Record<string, string> = {
  // Projects with email enumeration protection (staging and production) answer invalid-credential
  // for both; the emulator still answers user-not-found or wrong-password.
  'auth/invalid-credential': 'The email address or password is not right.',
  'auth/user-not-found': 'The email address or password is not right.',
  'auth/wrong-password': 'The email address or password is not right.',
  'auth/user-disabled': 'This account has been turned off. Please contact the executives.',
};

/** The time of day on this device, for the greeting. */
export function greeting(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * Login with email and password or Google (FR-1.1), and the app's first page: / leads
 * here. One of the four pages anyone can see without logging in (FR-1.12). An account whose email
 * is not verified goes to the check-email page (FR-1.2). After a session expires (FR-1.10,
 * core/session.ts) it opens saying so. After a Google login with the address of an email and
 * password account (GoogleSignIn), it asks for the password and then adds Google to the account
 * (FR-1.3, NKB-213).
 */
@Component({
  selector: 'app-login-page',
  imports: [AuthLayout, GoogleSignIn, RevealPassword, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly accounts = inject(Accounts);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly verification = inject(Verification);
  private readonly pendingLink = inject(PendingGoogleLink);

  protected readonly greeting = greeting(new Date().getHours());
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    remember: [false],
  });
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The Google sign-in waiting for this login, to add to the account (NKB-213). */
  protected readonly googleLink = this.pendingLink.link.asReadonly();
  /** Read once: the message goes when the page does. */
  protected readonly expired = this.session.expiredMessage();

  constructor() {
    this.session.expiredMessage.set(null);
    // The address is the one Google gave, so fill it in.
    effect(() => {
      const link = this.googleLink();
      if (link) {
        this.form.controls.email.setValue(link.email);
      }
    });
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    const { email, password, remember } = this.form.getRawValue();
    try {
      const user = await this.accounts.logIn(email.trim(), password, remember);
      if (!user.emailVerified) {
        // No email was sent this time, so an error from an earlier send must not show. An
        // unverified account is never linked to Google.
        this.verification.sendError.set(null);
        this.pendingLink.link.set(null);
        await this.router.navigateByUrl('/check-email');
        return;
      }
      // Creates the users record on a first login and starts the session (README, Worker).
      await this.session.start();
      await this.linkGoogle(user);
      await this.router.navigateByUrl('/home');
    } catch (error) {
      if (error instanceof ApiError) {
        // Logged in to Firebase, but the Worker refused or could not be reached. Signing out
        // can fail too, offline; the message and the form must still come back.
        await this.accounts.signOut().catch(() => undefined);
        this.error.set(error.message);
      } else {
        this.error.set(authErrorMessage(error, LOGIN_ERRORS));
      }
      this.busy.set(false);
    }
  }

  // NKB-213: adds the waiting Google sign-in to the account just logged in to, only when its
  // address is the one Google gave. Admins may log in with Google too (FR-1.9, NKB-213), so theirs
  // is linked as a member's is. Linking failing, as when that Google account already belongs to
  // another Nkabom account, does not undo the login: they can still use their password.
  private async linkGoogle(user: User): Promise<void> {
    const link = this.pendingLink.take();
    if (!link?.emailVerified || link.email.toLowerCase() !== user.email?.toLowerCase()) {
      return;
    }
    try {
      await this.accounts.linkGoogle(user, link.credential);
    } catch (error) {
      console.warn('Google not added to the account', error);
    }
  }

  protected invalid(field: 'email' | 'password'): boolean {
    return this.submitted() && this.form.controls[field].invalid;
  }
}
