import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Api, ApiError } from '../core/api';
import { Theme } from '../core/theme';
import { ForgotPasswordPage } from './forgot-password-page';

describe('ForgotPasswordPage', () => {
  const api = { post: vi.fn() };

  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ requested: true });
    TestBed.configureTestingModule({
      imports: [ForgotPasswordPage],
      providers: [
        provideRouter([]),
        { provide: Theme, useValue: { mode: signal('light'), toggle: vi.fn() } },
        { provide: Api, useValue: api },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    async function ask(email: string) {
      const input = page.querySelector<HTMLInputElement>('#email')!;
      input.value = email;
      input.dispatchEvent(new Event('input'));
      page.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    }

    return { page, ask };
  }

  it('asks the Worker for a link and says to check the email', async () => {
    const { page, ask } = await render();

    await ask('  ama@example.com ');

    expect(api.post).toHaveBeenCalledWith('/v1/password/reset-link', {
      email: 'ama@example.com',
    });
    expect(page.querySelector('h1')?.textContent).toContain('Check your email');
    expect(page.textContent).toContain("We've sent a password reset link to ama@example.com.");
  });

  it('asks for nothing with a bad email address', async () => {
    const { page, ask } = await render();

    await ask('not-an-email');

    expect(page.querySelector('#email-error')?.textContent).toContain('Enter a valid email');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the Worker’s error and stays on the form', async () => {
    api.post.mockRejectedValue(new ApiError(502, 'The email could not be sent'));
    const { page, ask } = await render();

    await ask('ama@example.com');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'The email could not be sent',
    );
    expect(page.querySelector('form')).not.toBeNull();
  });

  it('links back to the login page', async () => {
    const { page } = await render();

    expect(page.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
