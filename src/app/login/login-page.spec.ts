import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { ApiError } from '../core/api';
import { SESSION_EXPIRED, Session } from '../core/session';
import { Theme } from '../core/theme';
import { PendingGoogleLink } from '../google-sign-in/pending-google-link';
import { Verification } from '../sign-up/verification';
import { greeting, LoginPage } from './login-page';

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greeting(6)).toBe('Good morning');
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(18)).toBe('Good evening');
  });
});

describe('LoginPage', () => {
  const accounts = {
    logIn: vi.fn(),
    signOut: vi.fn(),
    logInWithGoogle: vi.fn(),
    googleRedirectResult: vi.fn(),
    linkGoogle: vi.fn(),
  };
  const session = { start: vi.fn(), expiredMessage: signal<string | null>(null) };
  const verification = { sendError: signal<string | null>(null) };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    accounts.logIn.mockReset().mockResolvedValue({ emailVerified: true });
    accounts.signOut.mockReset().mockResolvedValue(undefined);
    accounts.googleRedirectResult.mockReset().mockResolvedValue(null);
    accounts.linkGoogle.mockReset().mockResolvedValue(undefined);
    session.start.mockReset().mockResolvedValue({ uid: 'ama', role: 'member' });
    session.expiredMessage.set(null);
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: accounts },
        { provide: Session, useValue: session },
        { provide: Verification, useValue: verification },
        { provide: Theme, useValue: { mode: signal('light'), toggle: vi.fn() } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  async function render() {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    async function logIn(email: string, password: string, remember = false) {
      for (const [id, value] of [
        ['email', email],
        ['password', password],
      ]) {
        const input = page.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      if (remember) {
        page.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      }
      page.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    }

    return { page, logIn };
  }

  it('logs in, records the account with the Worker and goes home', async () => {
    const { logIn } = await render();

    await logIn(' ama@example.com ', 'correct horse', true);

    expect(accounts.logIn).toHaveBeenCalledWith('ama@example.com', 'correct horse', true);
    expect(session.start).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('says when a session has expired, once', async () => {
    session.expiredMessage.set(SESSION_EXPIRED);

    const { page } = await render();

    expect(page.querySelector('[role="status"]')?.textContent).toContain(SESSION_EXPIRED);
    expect(session.expiredMessage()).toBeNull();
    expect((await render()).page.querySelector('[role="status"]')).toBeNull();
  });

  it('is not remembered unless the box is ticked', async () => {
    const { logIn } = await render();

    await logIn('ama@example.com', 'correct horse');

    expect(accounts.logIn).toHaveBeenCalledWith('ama@example.com', 'correct horse', false);
  });

  it('sends an account with an unverified email to check it (FR-1.2)', async () => {
    accounts.logIn.mockResolvedValue({ emailVerified: false });
    // From an earlier, failed send in this tab.
    verification.sendError.set('The email could not be sent');
    const { logIn } = await render();

    await logIn('ama@example.com', 'correct horse');

    expect(session.start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/check-email');
    expect(verification.sendError()).toBeNull();
  });

  for (const code of ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password']) {
    it(`gives one answer for a wrong email or password (${code})`, async () => {
      accounts.logIn.mockRejectedValue({ code });
      const { page, logIn } = await render();

      await logIn('ama@example.com', 'wrong');

      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        'The email address or password is not right.',
      );
      expect(navigate).not.toHaveBeenCalled();
    });
  }

  it('has an eye button to show the password', async () => {
    const { page } = await render();

    page.querySelector<HTMLButtonElement>('app-reveal-password button')!.click();

    expect(page.querySelector<HTMLInputElement>('#password')!.type).toBe('text');
  });

  it('signs out again when the Worker refuses the account', async () => {
    session.start.mockRejectedValue(new ApiError(0, 'Nkabom could not be reached.'));
    const { page, logIn } = await render();

    await logIn('ama@example.com', 'correct horse');

    expect(accounts.signOut).toHaveBeenCalled();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('could not be reached');
  });

  it('still shows the error and the form when signing out again fails too', async () => {
    session.start.mockRejectedValue(new ApiError(0, 'Nkabom could not be reached.'));
    accounts.signOut.mockRejectedValue(new Error('offline'));
    const { page, logIn } = await render();

    await logIn('ama@example.com', 'correct horse');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('could not be reached');
    expect(page.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('shows inline errors and does not try with empty fields', async () => {
    const { page, logIn } = await render();

    await logIn('', '');

    expect(page.querySelector('#email-error')).not.toBeNull();
    expect(page.querySelector('#password-error')).not.toBeNull();
    expect(accounts.logIn).not.toHaveBeenCalled();
  });

  it('links to sign-up and to password reset', async () => {
    const { page } = await render();

    expect(page.querySelector('a[href="/sign-up"]')?.textContent).toContain('Create an account');
    expect(page.querySelector('a[href="/forgot-password"]')?.textContent).toContain(
      'Forgot password?',
    );
  });

  it('offers Google login, remembering the sign-in only when asked (NKB-210)', async () => {
    accounts.logInWithGoogle.mockResolvedValue(null);
    const { page } = await render();
    const google = () => page.querySelector<HTMLButtonElement>('app-google-sign-in button')!;

    google().click();
    await TestBed.inject(ApplicationRef).whenStable();
    page.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await TestBed.inject(ApplicationRef).whenStable();
    google().click();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(accounts.logInWithGoogle.mock.calls).toEqual([[false], [true]]);
  });

  // NKB-213: after a Google login with the address of an email and password account.
  describe('adding a waiting Google sign-in (FR-1.3)', () => {
    const credential = { idToken: 'google' };
    const user = { emailVerified: true, email: 'Ama@Example.com' };

    function waiting(emailVerified = true) {
      TestBed.inject(PendingGoogleLink).link.set({
        email: 'ama@example.com',
        emailVerified,
        credential: credential as never,
      });
    }

    beforeEach(() => {
      accounts.logIn.mockResolvedValue(user);
    });

    it('asks for the password, with the address filled in', async () => {
      waiting();
      const { page } = await render();

      expect(page.querySelector('[role="status"]')?.textContent).toContain(
        'Google will be added to it',
      );
      expect(page.querySelector<HTMLInputElement>('#email')!.value).toBe('ama@example.com');
    });

    it("adds Google to a member's account once they log in", async () => {
      waiting();
      const { logIn } = await render();

      await logIn('ama@example.com', 'correct horse');

      expect(accounts.linkGoogle).toHaveBeenCalledWith(user, credential);
      expect(navigate).toHaveBeenCalledWith('/home');
      expect(TestBed.inject(PendingGoogleLink).link()).toBeNull();
    });

    it("adds Google to an admin's account too (FR-1.9, NKB-213)", async () => {
      waiting();
      session.start.mockResolvedValue({ uid: 'kofi', role: 'admin' });
      const { logIn } = await render();

      await logIn('ama@example.com', 'correct horse');

      expect(accounts.linkGoogle).toHaveBeenCalledWith(user, credential);
      expect(navigate).toHaveBeenCalledWith('/home');
    });

    it('never links an address Google does not say is verified', async () => {
      waiting(false);
      const { logIn } = await render();

      await logIn('ama@example.com', 'correct horse');

      expect(accounts.linkGoogle).not.toHaveBeenCalled();
    });

    it('never links to an account with another address', async () => {
      waiting();
      accounts.logIn.mockResolvedValue({ emailVerified: true, email: 'abena@example.com' });
      const { logIn } = await render();

      await logIn('abena@example.com', 'correct horse');

      expect(accounts.linkGoogle).not.toHaveBeenCalled();
    });

    it('never links to an account whose address is not verified', async () => {
      waiting();
      accounts.logIn.mockResolvedValue({ emailVerified: false, email: 'ama@example.com' });
      const { logIn } = await render();

      await logIn('ama@example.com', 'correct horse');

      expect(accounts.linkGoogle).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/check-email');
      expect(TestBed.inject(PendingGoogleLink).link()).toBeNull();
    });

    it('still logs the member in when linking fails', async () => {
      waiting();
      accounts.linkGoogle.mockRejectedValue({ code: 'auth/credential-already-in-use' });
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { logIn } = await render();

      await logIn('ama@example.com', 'correct horse');

      expect(navigate).toHaveBeenCalledWith('/home');
    });
  });
});
