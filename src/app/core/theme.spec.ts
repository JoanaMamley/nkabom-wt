import { TestBed } from '@angular/core/testing';

import { THEME_STORAGE_KEY, Theme } from './theme';

/** A stand-in for the device's dark-mode setting, which jsdom does not provide. */
function stubDevice(dark: boolean) {
  const listeners: ((event: { matches: boolean }) => void)[] = [];
  const query = {
    matches: dark,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      listeners.push(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    set(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

describe('Theme', () => {
  let meta: HTMLMetaElement;

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  });

  afterEach(() => {
    meta.remove();
    vi.unstubAllGlobals();
  });

  function create(): Theme {
    const theme = TestBed.inject(Theme);
    TestBed.tick(); // run the effect that updates the page
    return theme;
  }

  it('follows the device setting on a first visit, without saving anything', () => {
    stubDevice(true);
    const theme = create();

    expect(theme.mode()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('keeps following the device while the user has not chosen', () => {
    const device = stubDevice(false);
    const theme = create();

    device.set(true);
    TestBed.tick();

    expect(theme.mode()).toBe('dark');
    expect(meta.content).toBe('#16120f');
  });

  it('switches mode, marks the page and remembers the choice', () => {
    stubDevice(false);
    const theme = create();

    theme.toggle();
    TestBed.tick();

    expect(theme.mode()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(meta.content).toBe('#16120f');

    theme.toggle();
    TestBed.tick();

    expect(theme.mode()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(meta.content).toBe('#e95300');
  });

  it('uses a saved choice over the device setting, as after a reload', () => {
    stubDevice(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const theme = create();

    expect(theme.mode()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('keeps the chosen mode when the device setting changes', () => {
    const device = stubDevice(false);
    const theme = create();
    theme.toggle();

    device.set(false);

    expect(theme.mode()).toBe('dark');
  });

  it('ignores an unknown saved value', () => {
    stubDevice(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');

    expect(create().mode()).toBe('light');
  });

  it('follows a switch made in another tab', () => {
    stubDevice(false);
    const theme = create();

    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));

    expect(theme.mode()).toBe('dark');
  });

  it('still switches when storage is blocked', () => {
    stubDevice(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const theme = create();

    theme.toggle();

    expect(theme.mode()).toBe('dark');
    vi.restoreAllMocks();
  });
});
