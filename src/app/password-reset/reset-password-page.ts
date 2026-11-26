import { Component, inject, OnInit, PendingTasks, signal } from '@angular/core';
import {
  type AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthLayout } from '../auth-layout/auth-layout';
import { Accounts } from '../core/accounts';
import { Api, ApiError } from '../core/api';
import { MIN_PASSWORD_LENGTH, SOMETHING_WENT_WRONG } from '../core/messages';
import { RevealPassword } from '../reveal-password/reveal-password';

type State = 'checking' | 'ready' | 'done' | 'expired' | 'invalid' | 'error';

/**
 * Where the emailed reset link lands (FR-1.4, NKB-203), and at /set-password the link a new admin
 * is emailed to set their first password (FR-1.8, NKB-208), which route data firstPassword marks.
 * The Worker checks the link first, so a used or expired one says so before anything is typed,
 * then sets the password. Public like the other emailed link (FR-1.12): whoever opens it is logged
 * out.
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

  /** A new admin's first password, rather than a reset. */
  protected readonly firstPassword = this.route.snapshot.data['firstPassword'] === true;
  /** How long the link works, as the Worker sets it (password-reset.ts). */
  protected readonly linkHours = this.firstPassword ? 72 : 1;
  private readonly endpoint = this.firstPassword ? '/v1/password/set' : '/v1/password/reset';

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );
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
      const { email } = await this.api.post<{ email: string }>(this.endpoint, this.link);
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
      const { password } = this.form.getRawValue();
      await this.api.post(this.endpoint, { ...this.link, password });
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        this.state.set('expired');
      } else {
        this.error.set(error instanceof ApiError ? error.message : SOMETHING_WENT_WRONG);
      }
      this.busy.set(false);
      return;
    }
    // Firebase has ended the account's sign-ins, so one on this device is stale. Someone signed in
    // here as a different account stays signed in.
    const user = await this.accounts.currentUser().catch(() => null);
    if (user?.uid === this.link.uid) {
      await this.accounts.signOut().catch(() => undefined);
    }
    this.state.set('done');
  }

  protected invalid(): boolean {
    return this.submitted() && this.form.controls.password.invalid;
  }

  /** The confirmation is empty, or does not match the new password. */
  protected mismatch(): boolean {
    return (
      this.submitted() &&
      this.form.controls.password.valid &&
      (this.form.controls.confirmPassword.invalid || this.form.hasError('mismatch'))
    );
  }
}

/** The new password typed twice the same, so a typing slip cannot lock the member out. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const { password, confirmPassword } = group.value as Record<string, string>;
  return password === confirmPassword ? null : { mismatch: true };
}

function stateFor(error: unknown): State {
  const status = error instanceof ApiError ? error.status : 0;
  return status === 410 ? 'expired' : status === 400 ? 'invalid' : 'error';
}
