import { Injectable, signal } from '@angular/core';

import { ApiError } from './api';

/** The code the Worker gives when an action needs a recent sign-in (worker/src/roles.ts). */
export const RECENT_SIGN_IN_REQUIRED = 'recent-sign-in-required';

/** What a page shows when the admin closes the dialog without confirming. */
export const NOT_CONFIRMED = 'Nothing was changed, as you did not confirm it was you.';

/** The Worker's request to confirm, while ConfirmSignIn shows it. */
export interface ConfirmRequest {
  message: string;
  /** Called with whether the user signed in again. */
  done: (confirmed: boolean) => void;
}

/**
 * The most sensitive actions, such as managing admins, need a sign-in from the last few minutes
 * (NKB-213). A page makes such a call through run(): if the Worker asks for a recent sign-in, the
 * app's ConfirmSignIn dialog asks the user to sign in again, and the call is made once more.
 */
@Injectable({ providedIn: 'root' })
export class RecentSignIn {
  readonly request = signal<ConfirmRequest | null>(null);

  async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === RECENT_SIGN_IN_REQUIRED)) {
        throw error;
      }
      const confirmed = await new Promise<boolean>((done) =>
        this.request.set({ message: error.message, done }),
      );
      this.request.set(null);
      if (!confirmed) {
        throw new ApiError(403, NOT_CONFIRMED);
      }
      return call();
    }
  }
}
