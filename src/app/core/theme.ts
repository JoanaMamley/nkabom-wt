import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

/** localStorage key for the user's choice. The inline script in index.html reads the same key. */
export const THEME_STORAGE_KEY = 'nkabom-theme';

// Browser bar colour in each mode: the brand colour in light mode, the page colour in dark mode.
const THEME_COLORS: Record<ThemeMode, string> = { light: '#e95300', dark: '#16120f' };

function isMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

/**
 * Light or dark mode (FR-8.8, FR-8.9). Follows the device setting until the user picks a mode,
 * then remembers the choice on this device, across every page and open tab.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView!;
  private readonly deviceQuery = this.window.matchMedia('(prefers-color-scheme: dark)');

  private readonly device = signal<ThemeMode>(this.deviceQuery.matches ? 'dark' : 'light');
  private readonly choice = signal<ThemeMode | null>(this.readChoice());

  /** The mode in use: the user's choice, or the device setting if they have not chosen. */
  readonly mode = computed(() => this.choice() ?? this.device());

  constructor() {
    this.deviceQuery.addEventListener('change', (event) =>
      this.device.set(event.matches ? 'dark' : 'light'),
    );
    // Another tab switched mode.
    this.window.addEventListener('storage', (event) => {
      if (event.key === THEME_STORAGE_KEY) {
        this.choice.set(isMode(event.newValue) ? event.newValue : null);
      }
    });

    effect(() => {
      const root = this.document.documentElement;
      const choice = this.choice();
      if (choice) {
        root.dataset['theme'] = choice;
      } else {
        delete root.dataset['theme'];
      }
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', THEME_COLORS[this.mode()]);
    });
  }

  toggle(): void {
    const next: ThemeMode = this.mode() === 'dark' ? 'light' : 'dark';
    this.choice.set(next);
    try {
      this.window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked (for example, some private windows): the choice lasts for this visit.
    }
  }

  private readChoice(): ThemeMode | null {
    try {
      const stored = this.window.localStorage.getItem(THEME_STORAGE_KEY);
      return isMode(stored) ? stored : null;
    } catch {
      return null;
    }
  }
}
