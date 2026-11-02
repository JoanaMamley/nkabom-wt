import { inject, Injectable, InjectionToken } from '@angular/core';

import { environment } from '../../environments/environment';
import { FIREBASE_AUTH } from './firebase';

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

  async post<T>(path: string, body: unknown = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const user = this.auth.currentUser;
    if (user) {
      headers['Authorization'] = `Bearer ${await user.getIdToken()}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Nkabom could not be reached. Check your connection and try again.');
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new ApiError(response.status, data.error ?? 'Something went wrong. Please try again.');
    }
    return data as T;
  }
}
