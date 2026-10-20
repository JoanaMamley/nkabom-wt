import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Theme, type ThemeMode } from '../core/theme';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  const mode = signal<ThemeMode>('light');
  const toggle = vi.fn(() => mode.update((current) => (current === 'dark' ? 'light' : 'dark')));

  beforeEach(() => {
    mode.set('light');
    toggle.mockClear();
    TestBed.configureTestingModule({
      imports: [ThemeToggle],
      providers: [{ provide: Theme, useValue: { mode, toggle } }],
    });
  });

  async function button(): Promise<HTMLButtonElement> {
    const fixture = TestBed.createComponent(ThemeToggle);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector('button')!;
  }

  it('names the mode it switches to', async () => {
    expect((await button()).getAttribute('aria-label')).toBe('Switch to dark mode');

    mode.set('dark');
    expect((await button()).getAttribute('aria-label')).toBe('Switch to light mode');
  });

  it('switches mode when pressed', async () => {
    const fixture = TestBed.createComponent(ThemeToggle);
    await fixture.whenStable();
    const element = (fixture.nativeElement as HTMLElement).querySelector('button')!;

    element.click();
    await fixture.whenStable();

    expect(toggle).toHaveBeenCalledOnce();
    expect(element.getAttribute('aria-label')).toBe('Switch to light mode');
  });
});
