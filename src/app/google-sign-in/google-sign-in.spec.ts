import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { ApiError } from '../core/api';
import { Session } from '../core/session';
import { GoogleSignIn } from './google-sign-in';

describe('GoogleSignIn', () => {
  const accounts = { logInWithGoogle: vi.fn(), googleRedirectResult: vi.fn(), signOut: vi.fn() };
  const session = { start: vi.fn() };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    accounts.logInWithGoogle.mockReset().mockResolvedValue({ uid: 'ama', emailVerified: true });
    accounts.googleRedirectResult.mockReset().mockResolvedValue(null);
    accounts.signOut.mockReset().mockResolvedValue(undefined);
    session.start.mockReset().mockResolvedValue({ uid: 'ama', role: 'member' });
    TestBed.configureTestingModule({
      imports: [GoogleSignIn],
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: accounts },
        { provide: Session, useValue: session },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  async function render(remember?: boolean) {
    const fixture = TestBed.createComponent(GoogleSignIn);
    if (remember !== undefined) {
      fixture.componentRef.setInput('remember', remember);
    }
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelector<HTMLButtonElement>('button')!;
    async function click() {
      button.click();
      await fixture.whenStable();
    }
    return { element, button, click };
  }

  it('logs a new Google user in, starts the session and goes home (FR-1.1)', async () => {
    const { button, click } = await render();
    expect(button.textContent).toContain('Continue with Google');

    await click();

    expect(accounts.logInWithGoogle).toHaveBeenCalledWith(true);
    expect(session.start).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('passes on whether to remember the sign-in', async () => {
    const { click } = await render(false);

    await click();

    expect(accounts.logInWithGoogle).toHaveBeenCalledWith(false);
  });

  it('finishes a login that went to Google and came back', async () => {
    accounts.googleRedirectResult.mockResolvedValue({ uid: 'ama', emailVerified: true });

    await render();

    expect(session.start).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('does nothing more while the page goes to Google', async () => {
    accounts.logInWithGoogle.mockResolvedValue(null);
    const { click } = await render();

    await click();

    expect(session.start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('signs an admin out again and says why, as the Worker refuses Google for admins (FR-1.9)', async () => {
    session.start.mockRejectedValue(new ApiError(403, 'Admins log in with email and password'));
    const { element, button, click } = await render();

    await click();

    expect(accounts.signOut).toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Admins log in with email and password',
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it('says nothing when the Google window is closed', async () => {
    accounts.logInWithGoogle.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    const { element, button, click } = await render();

    await click();

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(button.disabled).toBe(false);
  });

  it.each([
    ['auth/popup-blocked', 'Allow pop-ups for this site'],
    [
      'auth/account-exists-with-different-credential',
      'Log in with your email address and password',
    ],
    ['auth/network-request-failed', 'could not be reached'],
  ])('explains %s', async (code, message) => {
    accounts.logInWithGoogle.mockRejectedValue({ code });
    const { element, click } = await render();

    await click();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(message);
  });
});
