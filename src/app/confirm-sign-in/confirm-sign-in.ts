import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Accounts, installedOnIPhone } from '../core/accounts';
import { authErrorMessage } from '../core/messages';
import { RecentSignIn } from '../core/recent-sign-in';
import { RevealPassword } from '../reveal-password/reveal-password';

// Firebase Auth's error codes when signing in again, beside the shared ones (core/messages.ts).
const CONFIRM_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'That password is not right.',
  'auth/wrong-password': 'That password is not right.',
  'auth/user-mismatch': 'Choose the Google account you are logged in with.',
  'auth/popup-blocked':
    'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
};

/** Closing the Google window, or opening a second one, is not an error to report. */
const CANCELLED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

/**
 * Asks the signed-in user to sign in again, with their password or Google, when the Worker wants a
 * recent sign-in for an action (NKB-213, core/recent-sign-in.ts). Sits once in the app shell and
 * shows only while a request waits. In the app installed on an iPhone's Home Screen a Google
 * pop-up cannot hand the sign-in back, so an account with Google only is asked to log out and in.
 */
@Component({
  selector: 'app-confirm-sign-in',
  imports: [ReactiveFormsModule, RevealPassword],
  templateUrl: './confirm-sign-in.html',
  styleUrl: './confirm-sign-in.scss',
})
export class ConfirmSignIn {
  private readonly accounts = inject(Accounts);
  protected readonly request = inject(RecentSignIn).request;

  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly methods = computed(() =>
    this.request() ? this.accounts.signInMethods() : [],
  );
  protected readonly withPassword = computed(() => this.methods().includes('password'));
  protected readonly withGoogle = computed(
    () => this.methods().includes('google.com') && !installedOnIPhone(),
  );

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    // A new request starts afresh, with focus in the dialog for keyboards and screen readers.
    effect(() => {
      if (this.request()) {
        this.form.reset();
        this.error.set(null);
        this.busy.set(false);
      }
    });
    effect(() => this.heading()?.nativeElement.focus());
  }

  protected confirmWithPassword(): Promise<void> {
    if (this.form.invalid) {
      this.error.set('Enter your password.');
      return Promise.resolve();
    }
    return this.confirm(() => this.accounts.confirmWithPassword(this.form.getRawValue().password));
  }

  protected confirmWithGoogle(): Promise<void> {
    return this.confirm(() => this.accounts.confirmWithGoogle());
  }

  protected cancel(): void {
    this.request()?.done(false);
  }

  private async confirm(signIn: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await signIn();
      this.request()?.done(true);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? '';
      this.error.set(CANCELLED.includes(code) ? null : authErrorMessage(error, CONFIRM_ERRORS));
    }
    this.busy.set(false);
  }
}
