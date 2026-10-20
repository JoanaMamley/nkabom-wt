import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';
import { AppUpdates } from './core/app-updates';
import { Connectivity } from './core/connectivity';
import { Theme } from './core/theme';

describe('App', () => {
  const online = signal(true);
  const updates = { ready: signal(false), reload: vi.fn() };

  beforeEach(async () => {
    online.set(true);
    updates.ready.set(false);
    updates.reload.mockReset();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideServiceWorker('sw.js', { enabled: false }),
        { provide: Connectivity, useValue: { online } },
        { provide: AppUpdates, useValue: updates },
        { provide: Theme, useValue: { mode: signal('light'), toggle: vi.fn() } },
      ],
    }).compileComponents();
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const compiled = await render();
    expect(compiled.querySelector('h1')?.textContent).toContain('Nkabom');
  });

  it('shows the theme toggle on every page, offline included', async () => {
    online.set(false);
    const compiled = await render();

    expect(compiled.querySelector('header app-theme-toggle button')).not.toBeNull();
  });

  it('shows the offline page over the current page while offline', async () => {
    online.set(false);
    const compiled = await render();

    expect(compiled.querySelector('app-offline-page')?.textContent).toContain("You're offline");
    // The page underneath stays in place, hidden, so nothing typed into it is lost.
    expect(compiled.querySelector('main')?.closest('[hidden]')).not.toBeNull();
  });

  it('shows no offline page while online', async () => {
    const compiled = await render();

    expect(compiled.querySelector('app-offline-page')).toBeNull();
    expect(compiled.querySelector('main')?.closest('[hidden]')).toBeNull();
  });

  it('offers a reload once a new version is ready', async () => {
    updates.ready.set(true);
    const compiled = await render();

    expect(compiled.querySelector('[role="status"]')?.textContent).toContain(
      'A new version of Nkabom is ready.',
    );
    compiled.querySelector<HTMLButtonElement>('.update button')?.click();
    expect(updates.reload).toHaveBeenCalled();
  });
});
