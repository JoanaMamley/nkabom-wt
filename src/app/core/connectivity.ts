import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

/** Whether the device has a network connection, following the browser's online/offline events. */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  private readonly window = inject(DOCUMENT).defaultView!;

  readonly online = signal(this.window.navigator.onLine);

  constructor() {
    this.window.addEventListener('online', () => this.online.set(true));
    this.window.addEventListener('offline', () => this.online.set(false));
  }
}
