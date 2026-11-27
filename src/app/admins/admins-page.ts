import { Component, inject, OnInit, PendingTasks, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Api, ApiError } from '../core/api';
import { RecentSignIn } from '../core/recent-sign-in';
import { SOMETHING_WENT_WRONG } from '../core/messages';

/** An admin as GET /v1/admins lists them (AdminSummary in worker/src/admins.ts). */
export interface Admin {
  uid: string;
  name: string | null;
  email: string | null;
  calendarEmail: string | null;
  role: 'admin' | 'primaryAdmin';
  status: 'active' | 'deactivated';
  /** The Primary Admin viewing the page, whose own account they cannot change here. */
  self: boolean;
}

type State = 'loading' | 'ready' | 'denied' | 'error';

/**
 * Where a Primary Admin sees the admin accounts and manages them (FR-1.6, FR-1.7, NKB-209):
 * promote an admin to Primary Admin or demote one, deactivate and reactivate, or delete. Adding an admin is on its
 * own page (AddAdminPage). The Worker makes every check (worker/src/admins.ts), including that the
 * last Primary Admin is never demoted or deleted; the page only offers what it would allow, and so
 * offers nothing on the viewer's own account.
 */
@Component({
  selector: 'app-admins-page',
  imports: [RouterLink],
  templateUrl: './admins-page.html',
  styles: `
    .admins {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .admins > li {
      padding: 1rem 0;
      border-bottom: 1px solid var(--color-border);
    }
    .admins h2 {
      margin: 0 0 0.25rem;
      font-size: 1.0625rem;
    }
    .admins p {
      margin: 0.125rem 0;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--color-text-muted);
    }
    .admin-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
  `,
})
export class AdminsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly recentSignIn = inject(RecentSignIn);
  private readonly pendingTasks = inject(PendingTasks);

  protected readonly state = signal<State>('loading');
  protected readonly admins = signal<Admin[]>([]);
  /** The admin an action is running on, while it runs. */
  protected readonly busy = signal<string | null>(null);
  /** What the last action did, or why it failed. */
  protected readonly done = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Why the list could not be loaded. */
  protected readonly loadError = signal<string>(SOMETHING_WENT_WRONG);

  ngOnInit(): void {
    // Tracked, so the app is not stable (as tests wait for) until the page has settled.
    void this.pendingTasks.run(() => this.load());
  }

  private async load(): Promise<void> {
    try {
      const { admins } = await this.api.get<{ admins: Admin[] }>('/v1/admins');
      this.admins.set(admins);
      this.state.set('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        this.state.set('denied');
        return;
      }
      this.loadError.set(error instanceof ApiError ? error.message : SOMETHING_WENT_WRONG);
      this.state.set('error');
    }
  }

  protected label(admin: Admin): string {
    return admin.name ?? admin.email ?? 'This admin';
  }

  protected setRole(admin: Admin, role: Admin['role']): Promise<void> {
    const name = this.label(admin);
    return this.act(
      admin,
      () => this.api.patch(`/v1/admins/${admin.uid}`, { role }),
      role === 'primaryAdmin' ? `${name} is now a Primary Admin.` : `${name} is now an admin.`,
    );
  }

  protected deactivate(admin: Admin): Promise<void> {
    const name = this.label(admin);
    if (
      !confirm(
        `Deactivate ${name}? They will be logged out at once and cannot log in until reactivated.`,
      )
    ) {
      return Promise.resolve();
    }
    return this.act(
      admin,
      () => this.api.post(`/v1/admins/${admin.uid}/deactivate`),
      `${name} has been deactivated and logged out.`,
    );
  }

  protected reactivate(admin: Admin): Promise<void> {
    const name = this.label(admin);
    return this.act(
      admin,
      () => this.api.post(`/v1/admins/${admin.uid}/reactivate`),
      `${name} has been reactivated and can log in again.`,
    );
  }

  protected remove(admin: Admin): Promise<void> {
    const name = this.label(admin);
    if (!confirm(`Delete ${name}’s admin account? This cannot be undone.`)) {
      return Promise.resolve();
    }
    return this.act(
      admin,
      () => this.api.delete(`/v1/admins/${admin.uid}`),
      `${name}’s admin account has been deleted.`,
    );
  }

  /** Runs the action, then reloads the list, which a failure may have changed too. */
  private async act(admin: Admin, call: () => Promise<unknown>, success: string): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(admin.uid);
    this.done.set(null);
    this.error.set(null);
    try {
      // Managing admins needs a recent sign-in, which this asks for if needed (NKB-213).
      await this.recentSignIn.run(call);
      this.done.set(success);
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message || SOMETHING_WENT_WRONG : SOMETHING_WENT_WRONG,
      );
    }
    await this.load();
    this.busy.set(null);
  }
}
