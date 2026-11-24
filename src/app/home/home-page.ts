import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Session } from '../core/session';

/**
 * Where a logged-in member lands, until the registration form (NKB-301) and the member pages
 * replace it.
 */
@Component({
  selector: 'app-home-page',
  templateUrl: './home-page.html',
})
export class HomePage implements OnInit {
  private readonly accounts = inject(Accounts);
  private readonly router = inject(Router);
  private readonly session = inject(Session);

  protected readonly email = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.email.set((await this.accounts.currentUser())?.email ?? null);
  }

  protected async logOut(): Promise<void> {
    await this.session.logOut();
    await this.router.navigateByUrl('/login');
  }
}
