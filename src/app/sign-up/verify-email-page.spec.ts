import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Api, ApiError } from '../core/api';
import { VerifyEmailPage } from './verify-email-page';

describe('VerifyEmailPage', () => {
  const LINK = { uid: 'ama', expires: '1793440800', sig: 'signature' };
  const api = { post: vi.fn() };
  let user: {
    uid: string;
    reload: ReturnType<typeof vi.fn>;
    getIdToken: ReturnType<typeof vi.fn>;
  } | null;

  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ verified: true });
    user = null;
    TestBed.configureTestingModule({
      imports: [VerifyEmailPage],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        { provide: Accounts, useValue: { currentUser: async () => user } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(LINK) } },
        },
      ],
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(VerifyEmailPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('sends the link to the Worker and says the address is confirmed', async () => {
    const page = await render();

    expect(api.post).toHaveBeenCalledWith('/v1/email/verify', LINK);
    expect(page.querySelector('h1')?.textContent).toContain('Email address confirmed');
    expect(page.textContent).toContain('You can now log in');
  });

  it('refreshes the sign-in and offers to carry on on the device that signed up', async () => {
    user = { uid: 'ama', reload: vi.fn(), getIdToken: vi.fn() };
    const page = await render();

    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(page.querySelector('a.button')?.textContent).toContain('Continue');
  });

  it('says when the link has expired', async () => {
    api.post.mockRejectedValue(new ApiError(410, 'This link has expired'));
    const page = await render();

    expect(page.querySelector('h1')?.textContent).toContain('This link has expired');
  });

  it('offers a new link when the expired link is for this device’s sign-in', async () => {
    user = { uid: 'ama', reload: vi.fn(), getIdToken: vi.fn() };
    api.post.mockRejectedValue(new ApiError(410, 'This link has expired'));
    const page = await render();

    expect(page.querySelector('a.button')?.getAttribute('href')).toBe('/check-email');
  });

  it('says when the link is not valid', async () => {
    api.post.mockRejectedValue(new ApiError(400, 'This link is not valid'));
    const page = await render();

    expect(page.querySelector('h1')?.textContent).toContain('This link is not valid');
  });

  it('says when the Worker could not be reached', async () => {
    api.post.mockRejectedValue(new ApiError(0, 'offline'));
    const page = await render();

    expect(page.querySelector('h1')?.textContent).toContain('could not be confirmed');
  });
});
