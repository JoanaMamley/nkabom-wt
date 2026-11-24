import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthLayout } from '../auth-layout/auth-layout';
import { Api, ApiError } from '../core/api';

/**
 * "Forgot password?" from the login page (FR-1.4, NKB-203): asks the Worker to email a reset link
 * (worker/src/password-reset.ts). The Worker answers the same whether or not the address has an
 * account, so the page always says to check for the email.
 */
@Component({
  selector: 'app-forgot-password-page',
  imports: [AuthLayout, ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password-page.html',
})
export class ForgotPasswordPage {
  private readonly api = inject(Api);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The address the link was asked for, once it has been. */
  protected readonly sentTo = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    const email = this.form.getRawValue().email.trim();
    try {
      await this.api.post('/v1/password/reset-link', { email });
      this.sentTo.set(email);
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
    this.busy.set(false);
  }

  protected invalid(): boolean {
    return this.submitted() && this.form.controls.email.invalid;
  }
}
