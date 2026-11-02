import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AppUpdates } from './core/app-updates';
import { Connectivity } from './core/connectivity';
import { OfflinePage } from './offline/offline-page';
import { ThemeToggle } from './theme-toggle/theme-toggle';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, OfflinePage, ThemeToggle],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly online = inject(Connectivity).online;
  protected readonly updates = inject(AppUpdates);

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Whether the page brings its own layout (route data fullScreen), so the header and footer hide. */
  protected readonly fullScreen = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => {
        let route = this.route.snapshot;
        while (route.firstChild) {
          route = route.firstChild;
        }
        return route.data['fullScreen'] === true;
      }),
    ),
    { initialValue: false },
  );
}
