import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Accounts } from '../core/accounts';
import { CheckEmailPage } from './check-email-page';
import { Verification } from './verification';

describe('CheckEmailPage', () => {
  let user: {
    email: string;
    emailVerified: boolean;
    reload: ReturnType<typeof vi.fn>;
    getIdToken: ReturnType<typeof vi.fn>;
  } | null;
  const accounts = { currentUser: vi.fn(async () => user), signOut: vi.fn() };
  const verification = { send: vi.fn(), sendError: signal<string | null>(null) };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    user = {
      email: 'ama@example.com',
      emailVerified: false,
      reload: vi.fn(),
      getIdToken: vi.fn(),
    };
    verification.send.mockReset().mockResolvedValue(true);
    verification.sendError.set(null);
    accounts.signOut.mockReset();
    TestBed.configureTestingModule({
      imports: [CheckEmailPage],
      providers: [
        provideRouter([]),
        { provide: Accounts, useValue: accounts },
        { provide: Verification, useValue: verification },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  async function render() {
    const fixture = TestBed.createComponent(CheckEmailPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const click = async (text: string) => {
      [...page.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!.click();
      await fixture.whenStable();
    };
    return { page, click };
  }

  it('names the address the link went to', async () => {
    const { page } = await render();

    expect(page.textContent).toContain('ama@example.com');
    expect(page.textContent).toContain('expires in 24 hours');
  });

  it('says when the email could not be sent', async () => {
    verification.sendError.set('The email could not be sent');
    const { page } = await render();

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'The email could not be sent',
    );
  });

  it('sends another link on request', async () => {
    const { page, click } = await render();

    await click('Send another link');

    expect(verification.send).toHaveBeenCalled();
    expect(page.querySelector('[role="status"]')?.textContent).toContain('new link');
  });

  it('keeps the member here until the address is confirmed', async () => {
    const { page, click } = await render();

    await click('I have confirmed my email');

    expect(user!.reload).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(page.querySelector('[role="status"]')?.textContent).toContain('not confirmed yet');
  });

  it('carries on with a fresh token once the address is confirmed', async () => {
    const { click } = await render();
    user!.reload.mockImplementation(async () => (user!.emailVerified = true));

    await click('I have confirmed my email');

    expect(user!.getIdToken).toHaveBeenCalledWith(true);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('skips straight on for an address already confirmed', async () => {
    user!.emailVerified = true;
    await render();

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('signs out to sign up again with another address', async () => {
    const { click } = await render();

    await click('Sign up again');

    expect(accounts.signOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/sign-up');
  });

  it('explains what to do when no one is signed in', async () => {
    user = null;
    const { page } = await render();

    expect(page.querySelector('button')).toBeNull();
    expect(page.textContent).toContain('log in to get a new one');
  });
});
