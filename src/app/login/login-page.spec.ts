import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Api, ApiError } from '../core/api';
import { Theme } from '../core/theme';
import { greeting, LoginPage } from './login-page';

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greeting(6)).toBe('Good morning');
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(18)).toBe('Good evening');
  });
});

describe('LoginPage', () => {
  const accounts = { logIn: vi.fn(), signOut: vi.fn() };
  const api = { get: vi.fn() };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    accounts.logIn.mockReset().mockResolvedValue({ emailVerified: true });
    accounts.signOut.mockReset();
    api.get.mockReset().mockResolvedValue({ uid: 'ama', role: 'member' });
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: accounts },
        { provide: Api, useValue: api },
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
    expect(api.get).toHaveBeenCalledWith('/v1/me');
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('is not remembered unless the box is ticked', async () => {
    const { logIn } = await render();

    await logIn('ama@example.com', 'correct horse');

    expect(accounts.logIn).toHaveBeenCalledWith('ama@example.com', 'correct horse', false);
  });

  it('sends an account with an unverified email to check it (FR-1.2)', async () => {
    accounts.logIn.mockResolvedValue({ emailVerified: false });
    const { logIn } = await render();

    await logIn('ama@example.com', 'correct horse');

    expect(api.get).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/check-email');
  });

  it('gives one answer for a wrong email or password', async () => {
    accounts.logIn.mockRejectedValue({ code: 'auth/invalid-credential' });
    const { page, logIn } = await render();

    await logIn('ama@example.com', 'wrong');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'The email address or password is not right.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('signs out again when the Worker refuses the account', async () => {
    api.get.mockRejectedValue(new ApiError(0, 'Nkabom could not be reached.'));
    const { page, logIn } = await render();

    await logIn('ama@example.com', 'correct horse');

    expect(accounts.signOut).toHaveBeenCalled();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('could not be reached');
  });

  it('shows inline errors and does not try with empty fields', async () => {
    const { page, logIn } = await render();

    await logIn('', '');

    expect(page.querySelector('#email-error')).not.toBeNull();
    expect(page.querySelector('#password-error')).not.toBeNull();
    expect(accounts.logIn).not.toHaveBeenCalled();
  });

  it('links to sign-up, and shows password reset as coming soon', async () => {
    const { page } = await render();

    expect(page.querySelector('a[href="/sign-up"]')?.textContent).toContain('Create an account');
    expect(page.querySelector('[aria-disabled="true"]')?.textContent).toContain('coming soon');
  });
});
