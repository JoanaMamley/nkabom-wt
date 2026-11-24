import { Component, inject, OnInit, PendingTasks, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthLayout } from '../auth-layout/auth-layout';
import { Accounts } from '../core/accounts';
import { Api, ApiError } from '../core/api';
import { RevealPassword } from '../reveal-password/reveal-password';
import { MIN_PASSWORD_LENGTH } from '../sign-up/sign-up-page';

type State = 'checking' | 'ready' | 'done' | 'expired' | 'invalid' | 'error';

/**
 * Where the emailed reset link lands (FR-1.4, NKB-203). The Worker checks the link first, so a used
 * or expired one says so before anything is typed, then sets the new password. Public like the
 * other emailed link (FR-1.12): whoever opens it is logged out.
 */
@Component({
  selector: 'app-reset-password-page',
  imports: [AuthLayout, ReactiveFormsModule, RevealPassword, RouterLink],
  templateUrl: './reset-password-page.html',
})
export class ResetPasswordPage implements OnInit {
  private readonly accounts = inject(Accounts);
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly pendingTasks = inject(PendingTasks);

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
  });
  protected readonly state = signal<State>('checking');
  /** The address the link is for, so the member knows which account they are changing. */
  protected readonly email = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private get link() {
    const params = this.route.snapshot.queryParamMap;
    return { uid: params.get('uid'), expires: params.get('expires'), sig: params.get('sig') };
  }

  ngOnInit(): void {
    // Tracked, so the app is not stable (as tests wait for) until the page has settled.
    void this.pendingTasks.run(() => this.check());
  }

  private async check(): Promise<void> {
    try {
      const { email } = await this.api.post<{ email: string }>('/v1/password/reset', this.link);
      this.email.set(email);
      this.state.set('ready');
    } catch (error) {
      this.state.set(stateFor(error));
    }
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    try {
      await this.api.post('/v1/password/reset', { ...this.link, ...this.form.getRawValue() });
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        this.state.set('expired');
      } else {
        this.error.set(
          error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
        );
      }
      this.busy.set(false);
      return;
    }
    // Firebase has ended the account's sign-ins; any left on this device are stale.
    await this.accounts.signOut().catch(() => undefined);
    this.state.set('done');
  }

  protected invalid(): boolean {
    return this.submitted() && this.form.controls.password.invalid;
  }
}

function stateFor(error: unknown): State {
  const status = error instanceof ApiError ? error.status : 0;
  return status === 410 ? 'expired' : status === 400 ? 'invalid' : 'error';
}
