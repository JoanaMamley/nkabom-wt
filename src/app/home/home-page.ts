import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Accounts } from '../core/accounts';

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

  protected readonly email = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.email.set((await this.accounts.currentUser())?.email ?? null);
  }

  protected async logOut(): Promise<void> {
    await this.accounts.signOut();
    await this.router.navigateByUrl('/login');
  }
}
