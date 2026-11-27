import { Injectable, signal } from '@angular/core';

import type { GoogleLink } from '../core/accounts';

/**
 * A Google login refused because an email and password account already has the address
 * (NKB-213), kept while the member logs in with their password, after which the login page adds
 * Google to the account. It lives only in this tab's memory, so it goes when the page reloads.
 */
@Injectable({ providedIn: 'root' })
export class PendingGoogleLink {
  readonly link = signal<GoogleLink | null>(null);

  /** The waiting link, which is then no longer waiting. */
  take(): GoogleLink | null {
    const link = this.link();
    this.link.set(null);
    return link;
  }
}
