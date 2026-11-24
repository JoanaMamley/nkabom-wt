import { inject, Injectable, InjectionToken } from '@angular/core';

import { environment } from '../../environments/environment';
import { FIREBASE_AUTH } from './firebase';
import { SOMETHING_WENT_WRONG, UNREACHABLE } from './messages';

/**
 * How long to wait for the Worker. A request on a weak connection can stall without failing, and
 * would otherwise leave its page waiting for good (FR-8.1).
 */
export const API_TIMEOUT_MS = 20_000;

export const API_URL = new InjectionToken<string>('API_URL', {
  providedIn: 'root',
  factory: () => environment.apiUrl,
});

/** A failed call to the Worker: its HTTP status (0 if it could not be reached) and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Worker (README, Worker), signed in as the current user when there is one. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly url = inject(API_URL);

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>('POST', path, JSON.stringify(body));
  }

  private async request<T>(method: string, path: string, body?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const user = this.auth.currentUser;
    // A timer and AbortController rather than AbortSignal.timeout, which Safari has only from
    // iOS 16, and older iPhones stop at iOS 15.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response: Response;
    let data: { error?: string };
    try {
      // Getting the ID token can need the network too, to renew an old one.
      if (user) {
        headers['Authorization'] = `Bearer ${await user.getIdToken()}`;
      }
      response = await fetch(`${this.url}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      // Read within the time limit too: the body can stall after the headers arrive.
      data = (await response.json().catch((error: unknown) => {
        if (controller.signal.aborted) {
          throw error;
        }
        return {}; // No JSON body, as with 204.
      })) as { error?: string };
    } catch {
      throw new ApiError(0, UNREACHABLE);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new ApiError(response.status, data.error ?? SOMETHING_WENT_WRONG);
    }
    return data as T;
  }
}
