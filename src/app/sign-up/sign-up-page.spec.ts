import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { SignUpPage } from './sign-up-page';
import { Verification } from './verification';

describe('SignUpPage', () => {
  const accounts = { signUp: vi.fn() };
  const verification = { send: vi.fn() };

  beforeEach(() => {
    accounts.signUp.mockReset().mockResolvedValue({});
    verification.send.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [SignUpPage],
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: accounts },
        { provide: Verification, useValue: verification },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(SignUpPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    async function fill(email: string, password: string) {
      for (const [id, value] of [
        ['email', email],
        ['password', password],
      ]) {
        const input = page.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      page.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    }

    return { page, fill };
  }

  it('shows the privacy summary with a link to the notice (FR-1.15)', async () => {
    const { page } = await render();

    expect(page.querySelector('app-privacy-summary a')?.getAttribute('href')).toBe('/privacy');
  });

  it('creates the account, sends the verification email and asks the member to check it', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { fill } = await render();

    await fill('  ama@example.com ', 'correct horse');

    expect(accounts.signUp).toHaveBeenCalledWith('ama@example.com', 'correct horse');
    expect(verification.send).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/check-email');
  });

  it('still moves on when the email fails, so the next page can offer another', async () => {
    verification.send.mockResolvedValue(false);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { fill } = await render();

    await fill('ama@example.com', 'correct horse');

    expect(navigate).toHaveBeenCalledWith('/check-email');
  });

  it('shows inline errors and creates nothing for a bad email or short password', async () => {
    const { page, fill } = await render();

    await fill('not-an-email', 'short');

    expect(page.querySelector('#email-error')?.textContent).toContain('Enter a valid email');
    expect(page.querySelector('#password-hint')?.classList).toContain('field-error');
    expect(page.querySelector('#email')?.getAttribute('aria-invalid')).toBe('true');
    expect(accounts.signUp).not.toHaveBeenCalled();
  });

  it('explains a Firebase error in plain words', async () => {
    accounts.signUp.mockRejectedValue({ code: 'auth/email-already-in-use' });
    const { page, fill } = await render();

    await fill('ama@example.com', 'correct horse');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'An account already uses this email address.',
    );
    expect(verification.send).not.toHaveBeenCalled();
  });
});
