import { inject, Injectable, signal } from '@angular/core';

import { Api, ApiError } from '../core/api';

/**
 * Sends the email verification link (FR-1.2) through the Worker, which signs and emails it
 * (worker/src/verification.ts). Shared by the sign-up page, which sends the first email, and the
 * check-email page, which shows how that went and can send another.
 */
@Injectable({ providedIn: 'root' })
export class Verification {
  private readonly api = inject(Api);

  /** Why the last send failed, or null if it worked. */
  readonly sendError = signal<string | null>(null);

  /** Sends a link to the signed-in user's address. Returns whether it was sent. */
  async send(): Promise<boolean> {
    try {
      await this.api.post('/v1/email/verification');
      this.sendError.set(null);
      return true;
    } catch (error) {
      this.sendError.set(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
      return false;
    }
  }
}
