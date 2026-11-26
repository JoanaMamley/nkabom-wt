import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot } from '@angular/router';

import { Accounts } from './accounts';
import { Access, defaultDeny } from './guards';
import { Session } from './session';

describe('defaultDeny', () => {
  let user: { emailVerified: boolean } | null;
  const session = { resume: vi.fn() };
  const currentUser = vi.fn(async () => user);

  beforeEach(() => {
    session.resume.mockClear();
    currentUser.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: { currentUser } },
        { provide: Session, useValue: session },
      ],
    });
  });

  async function open(access?: Access): Promise<string> {
    const route = { data: access ? { access } : {} } as unknown as ActivatedRouteSnapshot;
    const result = await TestBed.runInInjectionContext(() =>
      defaultDeny(route, {} as RouterStateSnapshot),
    );
    return result === true ? 'allowed' : String(result);
  }

  it('keeps anyone not logged in, or not yet verified, off a page that says nothing', async () => {
    for (const someone of [null, { emailVerified: false }]) {
      user = someone;
      expect(await open()).toBe('/login');
      expect(await open('signedOut')).toBe('allowed');
      expect(await open('public')).toBe('allowed');
    }
    expect(session.resume).not.toHaveBeenCalled();
  });

  it('lets a logged-in member in, and sends them from login and sign-up to their home page', async () => {
    user = { emailVerified: true };
    expect(await open()).toBe('allowed');
    expect(await open('signedOut')).toBe('/home');
    expect(await open('public')).toBe('allowed');
  });

  it('watches the session of whoever reaches a logged-in page, however they came', async () => {
    user = { emailVerified: true };
    await open();
    expect(session.resume).toHaveBeenCalledTimes(1);
  });

  it('opens a public page without looking up the account', async () => {
    user = null;
    await open('public');
    expect(currentUser).not.toHaveBeenCalled();
  });
});
