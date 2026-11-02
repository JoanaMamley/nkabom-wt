import { TestBed } from '@angular/core/testing';

import { Api, ApiError } from '../core/api';
import { Verification } from './verification';

describe('Verification', () => {
  const api = { post: vi.fn() };

  beforeEach(() => {
    api.post.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
  });

  it('asks the Worker to email a link', async () => {
    api.post.mockResolvedValue({ sentTo: 'ama@example.com' });
    const verification = TestBed.inject(Verification);

    expect(await verification.send()).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/v1/email/verification');
    expect(verification.sendError()).toBeNull();
  });

  it('keeps the reason a send failed, and clears it once one works', async () => {
    const verification = TestBed.inject(Verification);
    api.post.mockRejectedValueOnce(new ApiError(429, 'Please wait a minute'));

    expect(await verification.send()).toBe(false);
    expect(verification.sendError()).toBe('Please wait a minute');

    api.post.mockResolvedValue({});
    await verification.send();
    expect(verification.sendError()).toBeNull();
  });
});
