import { Component, inject, OnInit, PendingTasks, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Verification } from './verification';

/**
 * After sign-up: asks the new member to open the link emailed to them (FR-1.2), and lets them send
 * another or carry on once they have used it. Their account cannot be used until then.
 */
@Component({
  selector: 'app-check-email-page',
  imports: [RouterLink],
  templateUrl: './check-email-page.html',
})
export class CheckEmailPage implements OnInit {
  private readonly accounts = inject(Accounts);
  private readonly router = inject(Router);
  protected readonly verification = inject(Verification);

  /** The signed-in address, or null once the sign-in has gone (such as on another device). */
  protected readonly email = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  private readonly pendingTasks = inject(PendingTasks);

  ngOnInit(): void {
    // Tracked, so the app is not stable (as tests wait for) until the page has settled.
    void this.pendingTasks.run(() => this.load());
  }

  private async load(): Promise<void> {
    const user = await this.accounts.currentUser();
    if (user?.emailVerified) {
      await this.router.navigateByUrl('/');
      return;
    }
    this.email.set(user?.email ?? null);
    this.loading.set(false);
  }

  protected async resend(): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    if (await this.verification.send()) {
      this.message.set('We have sent you a new link.');
    }
    this.busy.set(false);
  }

  /** After the member has opened the link, possibly on another device. */
  protected async continue(): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      const user = await this.accounts.currentUser();
      if (!user) {
        this.email.set(null);
        this.busy.set(false);
        return;
      }
      await user.reload();
      if (user.emailVerified) {
        // A new ID token, so the Worker and the rules see the verified address.
        await user.getIdToken(true);
        await this.router.navigateByUrl('/');
        return;
      }
      this.message.set(
        'Your email address is not confirmed yet. Open the link in the email we sent you.',
      );
    } catch {
      this.message.set('Nkabom could not be reached. Check your connection and try again.');
    }
    this.busy.set(false);
  }

  /** For a mistyped address: sign out and sign up again with the right one. */
  protected async startAgain(): Promise<void> {
    await this.accounts.signOut();
    await this.router.navigateByUrl('/sign-up');
  }
}
