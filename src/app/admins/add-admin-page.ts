import {
  afterNextRender,
  Component,
  type ElementRef,
  inject,
  Injector,
  OnInit,
  PendingTasks,
  signal,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Api, ApiError } from '../core/api';
import { SOMETHING_WENT_WRONG } from '../core/messages';
import type { Me } from '../core/session';

/** The longest name the Worker accepts (MAX_NAME_LENGTH in worker/src/admins.ts). */
export const MAX_NAME_LENGTH = 100;

/** What POST /v1/admins answers. */
interface CreatedAdmin {
  uid: string;
  email: string;
  name: string;
  calendarEmail: string;
}

type State = 'checking' | 'ready' | 'denied' | 'error';

/**
 * Where a Primary Admin adds an admin (FR-1.6, NKB-208): their name, login email and the Google
 * account for the birthday calendar. The Worker creates the account and emails the new admin a
 * link to set their password (worker/src/admins.ts). Only a Primary Admin sees the form; the
 * Worker refuses anyone else whatever the page shows (FR-1.11).
 */
@Component({
  selector: 'app-add-admin-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './add-admin-page.html',
})
export class AddAdminPage implements OnInit {
  private readonly api = inject(Api);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly injector = inject(Injector);

  protected readonly maxNameLength = MAX_NAME_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(MAX_NAME_LENGTH), notBlank]],
    email: ['', [Validators.required, Validators.email]],
    calendarEmail: ['', Validators.email],
  });
  protected readonly state = signal<State>('checking');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The admin just added, for the confirmation. */
  protected readonly added = signal<CreatedAdmin | null>(null);
  /** Why the role could not be checked: the Worker's reason, or that it could not be reached. */
  protected readonly checkError = signal<string>(SOMETHING_WENT_WRONG);

  // Where focus goes when the form gives way to the confirmation, and back, so keyboard and
  // screen reader users are not left on a button that has gone.
  private readonly addedHeading = viewChild<ElementRef<HTMLElement>>('addedHeading');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  ngOnInit(): void {
    // Tracked, so the app is not stable (as tests wait for) until the page has settled.
    void this.pendingTasks.run(() => this.check());
  }

  private async check(): Promise<void> {
    try {
      const me = await this.api.get<Me>('/v1/me');
      this.state.set(me.role === 'primaryAdmin' ? 'ready' : 'denied');
    } catch (error) {
      this.checkError.set(error instanceof ApiError ? error.message : SOMETHING_WENT_WRONG);
      this.state.set('error');
    }
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    const { name, email, calendarEmail } = this.form.getRawValue();
    try {
      const admin = await this.api.post<CreatedAdmin>('/v1/admins', {
        name: name.trim(),
        email: email.trim(),
        ...(calendarEmail.trim() && { calendarEmail: calendarEmail.trim() }),
      });
      this.added.set(admin);
      this.form.reset();
      this.submitted.set(false);
      this.focusAfterRender(() => this.addedHeading());
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message || SOMETHING_WENT_WRONG : SOMETHING_WENT_WRONG,
      );
    }
    this.busy.set(false);
  }

  /** Back to an empty form, to add someone else. */
  protected addAnother(): void {
    this.added.set(null);
    this.focusAfterRender(() => this.nameInput());
  }

  private focusAfterRender(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }

  protected invalid(field: 'name' | 'email' | 'calendarEmail'): boolean {
    return this.submitted() && this.form.controls[field].invalid;
  }
}

/** Spaces alone are not a name. */
function notBlank(control: { value: string }) {
  return control.value.trim() ? null : { blank: true };
}
