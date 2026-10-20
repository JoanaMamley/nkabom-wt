import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Tells the user when a new version has been deployed. The service worker keeps serving the
 * version the app opened with, so without this an installed app could stay on an old version
 * until every window is closed.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly location = inject(DOCUMENT).location;

  /** A new version is downloaded and starts on the next reload. */
  readonly ready = signal(false);

  constructor() {
    const updates = inject(SwUpdate);
    if (!updates.isEnabled) {
      return;
    }

    updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.ready.set(true);
      }
    });
    // The cached version is broken (for example, files were evicted): only a reload recovers.
    updates.unrecoverable.subscribe(() => this.location.reload());
  }

  reload(): void {
    this.location.reload();
  }
}
