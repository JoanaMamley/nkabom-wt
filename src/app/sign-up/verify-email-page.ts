import { Component, inject, OnInit, PendingTasks, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Api, ApiError } from '../core/api';

type State = 'verifying' | 'verified' | 'expired' | 'invalid' | 'error';

/**
 * Where the emailed verification link lands (FR-1.2). The Worker checks the link's signature and
 * expiry and marks the address as verified. It may be opened on another device from the one used
 * to sign up, so it needs no sign-in, but it is part of signing up and stays public (FR-1.12).
 */
@Component({
  selector: 'app-verify-email-page',
  imports: [RouterLink],
  templateUrl: './verify-email-page.html',
})
export class VerifyEmailPage implements OnInit {
  private readonly api = inject(Api);
  private readonly accounts = inject(Accounts);
  private readonly route = inject(ActivatedRoute);

  protected readonly state = signal<State>('verifying');
  /** Whether this device is signed in as the account the link is for. */
  protected readonly signedIn = signal(false);

  private readonly pendingTasks = inject(PendingTasks);

  ngOnInit(): void {
    // Tracked, so the app is not stable (as tests wait for) until the page has settled.
    void this.pendingTasks.run(() => this.verify());
  }

  private async verify(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const link = { uid: params.get('uid'), expires: params.get('expires'), sig: params.get('sig') };
    const user = await this.accounts.currentUser();
    this.signedIn.set(user !== null && user.uid === link.uid);

    try {
      await this.api.post('/v1/email/verify', link);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      this.state.set(status === 410 ? 'expired' : status === 400 ? 'invalid' : 'error');
      return;
    }
    if (user && this.signedIn()) {
      // A new ID token, so the Worker and the rules see the verified address.
      await user.reload();
      await user.getIdToken(true);
    }
    this.state.set('verified');
  }
}
