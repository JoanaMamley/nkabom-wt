import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Api, ApiError } from '../core/api';
import { Theme } from '../core/theme';
import { ResetPasswordPage } from './reset-password-page';

describe('ResetPasswordPage', () => {
  const LINK = { uid: 'ama', expires: '1793440800', sig: 'signature' };
  const api = { post: vi.fn() };
  const accounts = { signOut: vi.fn() };

  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ email: 'ama@example.com' });
    accounts.signOut.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideRouter([]),
        { provide: Theme, useValue: { mode: signal('light'), toggle: vi.fn() } },
        { provide: Api, useValue: api },
        { provide: Accounts, useValue: accounts },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(LINK) } },
        },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(ResetPasswordPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    async function choose(password: string) {
      const input = page.querySelector<HTMLInputElement>('#password')!;
      input.value = password;
      input.dispatchEvent(new Event('input'));
      page.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    }

    return { page, choose };
  }

  it('checks the link first and names the account it is for', async () => {
    const { page } = await render();

    expect(api.post).toHaveBeenCalledWith('/v1/password/reset', LINK);
    expect(page.querySelector('h1')?.textContent).toContain('Choose a new password');
    expect(page.textContent).toContain('ama@example.com');
  });

  it('sets the new password, signs this device out and offers to log in', async () => {
    const { page, choose } = await render();
    api.post.mockResolvedValue({ reset: true });

    await choose('correct horse');

    expect(api.post).toHaveBeenLastCalledWith('/v1/password/reset', {
      ...LINK,
      password: 'correct horse',
    });
    expect(accounts.signOut).toHaveBeenCalled();
    expect(page.querySelector('h1')?.textContent).toContain('Password changed');
    expect(page.querySelector('a.button')?.getAttribute('href')).toBe('/login');
  });

  it('sends nothing with a short password', async () => {
    const { page, choose } = await render();

    await choose('short');

    expect(page.querySelector('#password-hint')?.classList).toContain('field-error');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('shows the Worker’s error, such as when the link was used in another tab', async () => {
    const { page, choose } = await render();
    api.post.mockRejectedValue(
      new ApiError(400, 'This link is not valid or has already been used'),
    );

    await choose('correct horse');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('already been used');
    expect(accounts.signOut).not.toHaveBeenCalled();
  });

  it('says when the link has expired, and offers a new one', async () => {
    api.post.mockRejectedValue(new ApiError(410, 'This link has expired'));
    const { page } = await render();

    expect(page.querySelector('h1')?.textContent).toContain('This link has expired');
    expect(page.querySelector('a.button')?.getAttribute('href')).toBe('/forgot-password');
  });

  it('says when the link is not valid or used, before anything is typed', async () => {
    api.post.mockRejectedValue(
      new ApiError(400, 'This link is not valid or has already been used'),
    );
    const { page } = await render();

    expect(page.querySelector('h1')?.textContent).toContain('This link is not valid');
    expect(page.querySelector('form')).toBeNull();
  });

  it('says when the Worker could not be reached', async () => {
    api.post.mockRejectedValue(new ApiError(0, 'offline'));
    const { page } = await render();

    expect(page.querySelector('h1')?.textContent).toContain('could not be checked');
  });
});
