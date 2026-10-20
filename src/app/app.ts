import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AppUpdates } from './core/app-updates';
import { Connectivity } from './core/connectivity';
import { OfflinePage } from './offline/offline-page';
import { ThemeToggle } from './theme-toggle/theme-toggle';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OfflinePage, ThemeToggle],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly online = inject(Connectivity).online;
  protected readonly updates = inject(AppUpdates);
}
