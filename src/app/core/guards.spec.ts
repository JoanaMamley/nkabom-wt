import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot } from '@angular/router';

import { Accounts } from './accounts';
import { signedOutOnly, verifiedOnly } from './guards';

describe('route guards', () => {
  let user: { emailVerified: boolean } | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: { currentUser: async () => user } },
      ],
    });
  });

  async function run(guard: typeof signedOutOnly): Promise<string> {
    const result = await TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    return result === true ? 'allowed' : String(result);
  }

  it('sends a logged-in member from login and sign-up to their home page', async () => {
    user = { emailVerified: true };
    expect(await run(signedOutOnly)).toBe('/home');
    expect(await run(verifiedOnly)).toBe('allowed');
  });

  it('keeps everyone else on login and sign-up, and off the home page', async () => {
    for (const someone of [null, { emailVerified: false }]) {
      user = someone;
      expect(await run(signedOutOnly)).toBe('allowed');
      expect(await run(verifiedOnly)).toBe('/login');
    }
  });
});
