import { TestBed } from '@angular/core/testing';

import { Accounts } from '../core/accounts';
import { RecentSignIn } from '../core/recent-sign-in';
import { ConfirmSignIn } from './confirm-sign-in';

describe('ConfirmSignIn', () => {
  const accounts = {
    signInMethods: vi.fn(),
    confirmWithPassword: vi.fn(),
    confirmWithGoogle: vi.fn(),
  };
  let done: ReturnType<typeof vi.fn<(confirmed: boolean) => void>>;

  beforeEach(() => {
    accounts.signInMethods.mockReset().mockReturnValue(['password', 'google.com']);
    accounts.confirmWithPassword.mockReset().mockResolvedValue(undefined);
    accounts.confirmWithGoogle.mockReset().mockResolvedValue(undefined);
    done = vi.fn<(confirmed: boolean) => void>();
    TestBed.configureTestingModule({
      imports: [ConfirmSignIn],
      providers: [{ provide: Accounts, useValue: accounts }],
    });
  });

  async function render(ask = true) {
    const fixture = TestBed.createComponent(ConfirmSignIn);
    if (ask) {
      TestBed.inject(RecentSignIn).request.set({ message: 'Confirm it is you.', done });
    }
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = (text: string) =>
      [...element.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
    async function settle() {
      await fixture.whenStable();
    }
    return { element, button, settle };
  }

  it('shows nothing until asked', async () => {
    const { element } = await render(false);
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });

  it('offers each way the account can sign in, with the Worker message', async () => {
    const { element, button } = await render();
    expect(element.querySelector('[role="dialog"]')?.textContent).toContain('Confirm it is you.');
    expect(button('Confirm with password')).toBeTruthy();
    expect(button('Confirm with Google')).toBeTruthy();

    accounts.signInMethods.mockReturnValue(['google.com']);
    expect((await render()).button('Confirm with password')).toBeUndefined();
  });

  it('confirms with the password', async () => {
    const { element, button, settle } = await render();
    const input = element.querySelector<HTMLInputElement>('#confirm-password')!;
    input.value = 'correct horse';
    input.dispatchEvent(new Event('input'));

    button('Confirm with password')!.click();
    await settle();

    expect(accounts.confirmWithPassword).toHaveBeenCalledWith('correct horse');
    expect(done).toHaveBeenCalledWith(true);
  });

  it('says when the password is wrong, and waits', async () => {
    accounts.confirmWithPassword.mockRejectedValue({ code: 'auth/invalid-credential' });
    const { element, button, settle } = await render();
    const input = element.querySelector<HTMLInputElement>('#confirm-password')!;
    input.value = 'wrong';
    input.dispatchEvent(new Event('input'));

    button('Confirm with password')!.click();
    await settle();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain('not right');
    expect(done).not.toHaveBeenCalled();
  });

  it('confirms with Google, and asks for the same Google account', async () => {
    const { element, button, settle } = await render();
    button('Confirm with Google')!.click();
    await settle();
    expect(done).toHaveBeenCalledWith(true);

    accounts.confirmWithGoogle.mockRejectedValue({ code: 'auth/user-mismatch' });
    done.mockClear();
    button('Confirm with Google')!.click();
    await settle();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Google account you are logged in with',
    );
    expect(done).not.toHaveBeenCalled();
  });

  it('cancels', async () => {
    const { button } = await render();
    button('Cancel')!.click();
    expect(done).toHaveBeenCalledWith(false);
  });
});
