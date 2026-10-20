import { Component, computed, inject } from '@angular/core';

import { Theme } from '../core/theme';

/** Switches between light and dark mode. In the header, so it is on every page (FR-8.8). */
@Component({
  selector: 'app-theme-toggle',
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.scss',
})
export class ThemeToggle {
  protected readonly theme = inject(Theme);
  protected readonly label = computed(() =>
    this.theme.mode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
  );
}
