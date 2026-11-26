import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Api } from '../core/api';
import { type Me, Session } from '../core/session';

/**
 * Where a logged-in member lands, until the registration form (NKB-301) and the member pages
 * replace it.
 */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  templateUrl: './home-page.html',
})
export class HomePage implements OnInit {
  private readonly accounts = inject(Accounts);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly session = inject(Session);

  protected readonly email = signal<string | null>(null);
  /** Whether to offer managing admins (FR-1.6, FR-1.7), which only a Primary Admin can. */
  protected readonly primaryAdmin = signal(false);

  async ngOnInit(): Promise<void> {
    this.email.set((await this.accounts.currentUser())?.email ?? null);
    try {
      const me = await this.api.get<Me>('/v1/me');
      this.primaryAdmin.set(me.role === 'primaryAdmin');
    } catch {
      // Without the role, the page offers nothing extra; a 401 has logged out already.
    }
  }

  protected async logOut(): Promise<void> {
    await this.session.logOut();
    await this.router.navigateByUrl('/login');
  }
}
