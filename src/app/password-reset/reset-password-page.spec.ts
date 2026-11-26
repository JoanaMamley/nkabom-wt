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
  let signedInAs: { uid: string } | null;
  // The route's data: firstPassword at /set-password.
  let routeData: Record<string, unknown>;
  const accounts = { signOut: vi.fn(), currentUser: vi.fn(async () => signedInAs) };

  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ email: 'ama@example.com' });
    accounts.signOut.mockReset().mockResolvedValue(undefined);
    // This device is signed in as the account being reset.
    signedInAs = { uid: LINK.uid };
    routeData = {};
    TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideRouter([]),
        { provide: Theme, useValue: { mode: signal('light'), toggle: vi.fn() } },
        { provide: Api, useValue: api },
        { provide: Accounts, useValue: accounts },
        {
          provide: ActivatedRoute,
          useFactory: () => ({
            snapshot: { queryParamMap: convertToParamMap(LINK), data: routeData },
          }),
        },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(ResetPasswordPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    // Types the new password, and the same again to confirm it unless told otherwise.
    async function choose(password: string, confirmation = password) {
      for (const [id, value] of [
        ['password', password],
        ['confirm-password', confirmation],
      ]) {
        const input = page.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
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

  it('leaves a different account signed in on this device', async () => {
    signedInAs = { uid: 'kofi' };
    const { page, choose } = await render();
    api.post.mockResolvedValue({ reset: true });

    await choose('correct horse');

    expect(accounts.signOut).not.toHaveBeenCalled();
    expect(page.querySelector('h1')?.textContent).toContain('Password changed');
  });

  it('sends nothing with a short password', async () => {
    const { page, choose } = await render();

    await choose('short');

    expect(page.querySelector('#password-hint')?.classList).toContain('field-error');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('sends nothing until the confirmation matches the new password', async () => {
    const { page, choose } = await render();

    await choose('correct horse', 'correct hrose');

    expect(page.querySelector('#confirm-error')?.textContent).toContain(
      'The passwords do not match.',
    );
    expect(page.querySelector('#confirm-password')?.getAttribute('aria-invalid')).toBe('true');
    expect(api.post).toHaveBeenCalledTimes(1);

    await choose('correct horse', '');
    expect(page.querySelector('#confirm-error')).not.toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('has an eye button on both password fields', async () => {
    const { page } = await render();

    expect(page.querySelectorAll('app-reveal-password')).toHaveLength(2);
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

  describe('at /set-password, for a new admin (FR-1.8)', () => {
    beforeEach(() => {
      routeData = { firstPassword: true };
    });

    it('checks the link with the Worker’s set-password endpoint', async () => {
      const { page } = await render();

      expect(api.post).toHaveBeenCalledWith('/v1/password/set', LINK);
      expect(page.querySelector('h1')?.textContent).toContain('Choose your password');
      expect(page.querySelector('label[for="password"]')?.textContent?.trim()).toBe('Password');
    });

    it('sets their first password and offers to log in', async () => {
      const { page, choose } = await render();
      api.post.mockResolvedValue({ reset: true });

      await choose('correct horse');

      expect(api.post).toHaveBeenLastCalledWith('/v1/password/set', {
        ...LINK,
        password: 'correct horse',
      });
      expect(page.querySelector('h1')?.textContent).toContain('Password set');
      expect(page.querySelector('a.button')?.getAttribute('href')).toBe('/login');
    });

    it('says the link lasts 72 hours, and how to get a new one, once expired', async () => {
      api.post.mockRejectedValue(new ApiError(410, 'This link has expired'));
      const { page } = await render();

      expect(page.querySelector('h1')?.textContent).toContain('This link has expired');
      expect(page.textContent).toContain('Links work for 72 hours');
      expect(page.querySelector('a.button')?.getAttribute('href')).toBe('/forgot-password');
    });
  });
});
