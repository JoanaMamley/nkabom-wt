import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Router } from '@angular/router';

import { routes } from './app.routes';
import { Accounts } from './core/accounts';
import { defaultDeny } from './core/guards';
import { Session } from './core/session';

interface Page {
  url: string;
  /** Whether defaultDeny runs for it, from any route above it. */
  guarded: boolean;
}

/** Every page in the app, however deep it sits. */
function pages(list: Route[], parent = '', guarded = false): Page[] {
  return list.flatMap((route) => {
    const path = [parent, route.path].filter(Boolean).join('/');
    const below = guarded || (route.canActivateChild ?? []).includes(defaultDeny);
    return [
      ...(route.component || route.loadComponent ? [{ url: `/${path}`, guarded }] : []),
      ...pages(route.children ?? [], path, below),
    ];
  });
}

/** What someone logged out can open (FR-1.12). */
const PUBLIC_PAGES = [
  '/check-email',
  '/forgot-password',
  '/login',
  '/privacy',
  '/reset-password',
  '/sign-up',
  '/verify-email',
];

describe('routes (FR-1.12)', () => {
  let user: { emailVerified: boolean } | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: Accounts, useValue: { currentUser: async () => user } },
        { provide: Session, useValue: { resume: vi.fn() } },
      ],
    });
  });

  async function reachable(): Promise<string[]> {
    const router = TestBed.inject(Router);
    const reached: string[] = [];
    for (const { url } of pages(routes)) {
      await router.navigateByUrl(url);
      if (router.url === url) {
        reached.push(url);
      }
    }
    return reached.sort();
  }

  it('lets someone logged out open only login, sign-up and the privacy notice, with their steps', async () => {
    user = null;
    expect(await reachable()).toEqual(PUBLIC_PAGES);
  });

  it('lets a logged-in member open the pages for members', async () => {
    user = { emailVerified: true };
    const reached = await reachable();
    expect(reached).toContain('/home');
    expect(reached).not.toContain('/login');
  });

  it('treats an account whose email is not verified as logged out', async () => {
    user = { emailVerified: false };
    expect(await reachable()).toEqual(PUBLIC_PAGES);
  });

  it('sends someone logged out from every other page to the login page', async () => {
    user = null;
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/home');
    expect(router.url).toBe('/login');
  });

  it('puts every page behind the default-deny guard', () => {
    const outside = pages(routes).filter((page) => !page.guarded);
    expect(outside).toEqual([]);
  });
});
