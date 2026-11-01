import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { PrivacySummary } from '../privacy/privacy-summary';
import { Verification } from './verification';

/** The shortest password allowed. Firebase's own minimum is 6. */
export const MIN_PASSWORD_LENGTH = 8;

// Firebase Auth's error codes, in words a member can act on.
const SIGN_UP_ERRORS: Record<string, string> = {
  'auth/email-already-in-use': 'An account already uses this email address.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  'auth/network-request-failed':
    'Nkabom could not be reached. Check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts from this device. Please try again later.',
};

/**
 * Sign-up with email and password (NKB-202, FR-1.1, FR-1.2). One of the three pages anyone can see
 * without logging in (FR-1.12). Creates the Firebase account, has the Worker email a verification
 * link, then shows the check-email page. The account cannot log in until the address is verified.
 */
@Component({
  selector: 'app-sign-up-page',
  imports: [ReactiveFormsModule, PrivacySummary],
  templateUrl: './sign-up-page.html',
  styleUrl: './sign-up-page.scss',
})
export class SignUpPage {
  private readonly accounts = inject(Accounts);
  private readonly router = inject(Router);
  private readonly verification = inject(Verification);

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
  });
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();
    try {
      await this.accounts.signUp(email.trim(), password);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      this.error.set(SIGN_UP_ERRORS[code] ?? 'Something went wrong. Please try again.');
      this.busy.set(false);
      return;
    }
    // The account exists now. If the email fails, the next page says so and offers another try.
    await this.verification.send();
    await this.router.navigateByUrl('/check-email');
  }

  protected invalid(field: 'email' | 'password'): boolean {
    return this.submitted() && this.form.controls[field].invalid;
  }
}
