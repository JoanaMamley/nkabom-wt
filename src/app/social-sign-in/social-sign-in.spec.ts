import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { ApiError } from '../core/api';
import { Session } from '../core/session';
import { FACEBOOK_LOGIN, SocialSignIn } from './social-sign-in';

/** A signed-in Firebase user, with the calls refreshSignIn makes. */
function user(emailVerified: boolean) {
  const signedIn = {
    uid: 'ama',
    emailVerified,
    // The Worker has marked the address verified by the time the app reloads the user.
    reload: vi.fn(async () => {
      signedIn.emailVerified = true;
    }),
    getIdToken: vi.fn(async () => 'token'),
  };
  return signedIn;
}

describe('SocialSignIn', () => {
  const accounts = {
    logInWith: vi.fn(),
    pendingRedirect: vi.fn(),
    socialRedirectResult: vi.fn(),
    signOut: vi.fn(),
  };
  const session = { start: vi.fn() };
  let navigate: ReturnType<typeof vi.spyOn>;
  /** Whether this project's Meta app is published. */
  let facebookLogin: boolean;

  beforeEach(() => {
    facebookLogin = true;
    accounts.logInWith.mockReset().mockResolvedValue(user(true));
    accounts.pendingRedirect.mockReset().mockReturnValue(null);
    accounts.socialRedirectResult.mockReset().mockResolvedValue(null);
    accounts.signOut.mockReset().mockResolvedValue(undefined);
    session.start.mockReset().mockResolvedValue({ uid: 'ama', role: 'member' });
    TestBed.configureTestingModule({
      imports: [SocialSignIn],
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: accounts },
        { provide: Session, useValue: session },
        { provide: FACEBOOK_LOGIN, useFactory: () => facebookLogin },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  async function render(remember?: boolean) {
    const fixture = TestBed.createComponent(SocialSignIn);
    if (remember !== undefined) {
      fixture.componentRef.setInput('remember', remember);
    }
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const buttons = () => [...element.querySelectorAll<HTMLButtonElement>('button')];
    const button = (name: 'Google' | 'Facebook') =>
      buttons().find((each) => each.textContent?.includes(name))!;
    async function click(name: 'Google' | 'Facebook') {
      button(name).click();
      await fixture.whenStable();
    }
    const alert = () => element.querySelector('[role="alert"]')?.textContent ?? null;
    return { fixture, buttons, button, click, alert };
  }

  it('offers Google and Facebook', async () => {
    const { buttons } = await render();

    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      'Continue with Google',
      'Continue with Facebook',
    ]);
  });

  it('logs a new Google user in, starts the session and goes home (FR-1.1)', async () => {
    const google = user(true);
    accounts.logInWith.mockResolvedValue(google);
    const { click } = await render();

    await click('Google');

    expect(accounts.logInWith).toHaveBeenCalledWith('google', true);
    expect(session.start).toHaveBeenCalled();
    expect(google.reload).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('logs a new Facebook user in, then refreshes the sign-in the Worker has verified (NKB-211)', async () => {
    const facebook = user(false);
    accounts.logInWith.mockResolvedValue(facebook);
    const { click } = await render();

    await click('Facebook');

    expect(accounts.logInWith).toHaveBeenCalledWith('facebook', true);
    expect(session.start).toHaveBeenCalled();
    expect(facebook.reload).toHaveBeenCalled();
    expect(facebook.getIdToken).toHaveBeenCalledWith(true);
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('passes on whether to remember the sign-in', async () => {
    const { click } = await render(false);

    await click('Facebook');

    expect(accounts.logInWith).toHaveBeenCalledWith('facebook', false);
  });

  it('disables both buttons and names the provider while one runs', async () => {
    let finish!: (value: null) => void;
    accounts.logInWith.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { fixture, buttons, button } = await render();

    button('Facebook').click();
    fixture.detectChanges();

    expect(buttons().every((each) => each.disabled)).toBe(true);
    expect(button('Facebook').textContent).toContain('Connecting to Facebook…');
    finish(null);
    // Let the login's promise settle before waiting for the page.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(buttons().every((each) => !each.disabled)).toBe(true);
  });

  it('finishes a login that went to the provider and came back', async () => {
    accounts.pendingRedirect.mockReturnValue('facebook');
    accounts.socialRedirectResult.mockResolvedValue(user(false));

    await render();

    expect(session.start).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('does not ask Firebase for a redirect result when none is pending', async () => {
    await render();

    expect(accounts.socialRedirectResult).not.toHaveBeenCalled();
  });

  it('does nothing more while the page goes to the provider', async () => {
    accounts.logInWith.mockResolvedValue(null);
    const { click } = await render();

    await click('Google');

    expect(session.start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['Google', 'Facebook'] as const)(
    'signs an admin out again and says why, as the Worker refuses %s for admins (FR-1.9)',
    async (name) => {
      session.start.mockRejectedValue(new ApiError(403, 'Admins log in with email and password'));
      const { button, click, alert } = await render();

      await click(name);

      expect(accounts.signOut).toHaveBeenCalled();
      expect(alert()).toContain('Admins log in with email and password');
      expect(navigate).not.toHaveBeenCalled();
      expect(button(name).disabled).toBe(false);
    },
  );

  it('signs out again if the verified sign-in cannot be fetched', async () => {
    const facebook = user(false);
    facebook.reload.mockRejectedValue({ code: 'auth/network-request-failed' });
    accounts.logInWith.mockResolvedValue(facebook);
    const { click, alert } = await render();

    await click('Facebook');

    expect(accounts.signOut).toHaveBeenCalled();
    expect(alert()).toContain('could not be reached');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says Facebook login is not available yet where its Meta app is not published', async () => {
    facebookLogin = false;
    const { click, alert, button } = await render();

    await click('Facebook');

    expect(alert()).toContain('Facebook login is not available yet');
    expect(accounts.logInWith).not.toHaveBeenCalled();
    expect(button('Facebook').disabled).toBe(false);

    await click('Google');

    expect(accounts.logInWith).toHaveBeenCalledWith('google', true);
  });

  it('says nothing when the provider’s window is closed', async () => {
    accounts.logInWith.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    const { click, alert } = await render();

    await click('Facebook');

    expect(alert()).toBeNull();
    expect(accounts.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['Google', 'auth/popup-blocked', 'blocked the Google window'],
    ['Facebook', 'auth/popup-blocked', 'blocked the Facebook window'],
    ['Facebook', 'auth/account-exists-with-different-credential', 'Log in the way you did before'],
    ['Google', 'auth/network-request-failed', 'could not be reached'],
  ] as const)('explains a %s login’s %s', async (name, code, message) => {
    accounts.logInWith.mockRejectedValue({ code });
    const { click, alert } = await render();

    await click(name);

    expect(alert()).toContain(message);
  });
});
