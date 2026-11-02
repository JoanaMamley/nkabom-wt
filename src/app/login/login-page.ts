import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthLayout } from '../auth-layout/auth-layout';
import { Accounts } from '../core/accounts';
import { Api, ApiError } from '../core/api';

// Firebase Auth's error codes, in words a member can act on. Wrong email and wrong password get
// the same answer, so the page does not reveal which addresses have accounts.
const LOGIN_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'The email address or password is not right.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-disabled': 'This account has been turned off. Please contact the executives.',
  'auth/network-request-failed':
    'Nkabom could not be reached. Check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts from this device. Please try again later.',
};

/** The time of day on this device, for the greeting. */
export function greeting(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * Login with email and password (FR-1.1), and the app's first page: / leads here. One of the
 * three pages anyone can see without logging in (FR-1.12). An account whose email is not
 * verified goes to the check-email page (FR-1.2). Session expiry is NKB-205's.
 */
@Component({
  selector: 'app-login-page',
  imports: [AuthLayout, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly accounts = inject(Accounts);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly greeting = greeting(new Date().getHours());
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    remember: [false],
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

    const { email, password, remember } = this.form.getRawValue();
    try {
      const user = await this.accounts.logIn(email.trim(), password, remember);
      if (!user.emailVerified) {
        await this.router.navigateByUrl('/check-email');
        return;
      }
      // Creates the users record on a first login (README, Worker).
      await this.api.get('/v1/me');
      await this.router.navigateByUrl('/home');
    } catch (error) {
      if (error instanceof ApiError) {
        // Logged in to Firebase, but the Worker refused or could not be reached.
        await this.accounts.signOut();
        this.error.set(error.message);
      } else {
        const code = (error as { code?: string }).code ?? '';
        this.error.set(LOGIN_ERRORS[code] ?? 'Something went wrong. Please try again.');
      }
      this.busy.set(false);
    }
  }

  protected invalid(field: 'email' | 'password'): boolean {
    return this.submitted() && this.form.controls[field].invalid;
  }
}
