import { TestBed } from '@angular/core/testing';

import { ApiError } from './api';
import { NOT_CONFIRMED, RECENT_SIGN_IN_REQUIRED, RecentSignIn } from './recent-sign-in';

describe('RecentSignIn', () => {
  let recent: RecentSignIn;
  const needsSignIn = () => new ApiError(403, 'Confirm it is you.', RECENT_SIGN_IN_REQUIRED);

  beforeEach(() => {
    recent = TestBed.inject(RecentSignIn);
  });

  it('passes a call through when the Worker does not ask', async () => {
    expect(await recent.run(async () => 'done')).toBe('done');
    expect(recent.request()).toBeNull();
  });

  it('passes other errors on', async () => {
    const error = new ApiError(403, 'Only a Primary Admin can do this');
    await expect(
      recent.run(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(recent.request()).toBeNull();
  });

  it('asks to confirm with the Worker message, then makes the call again', async () => {
    const call = vi.fn().mockRejectedValueOnce(needsSignIn()).mockResolvedValue('done');
    const result = recent.run(call);
    await vi.waitFor(() => expect(recent.request()?.message).toBe('Confirm it is you.'));

    recent.request()!.done(true);

    expect(await result).toBe('done');
    expect(call).toHaveBeenCalledTimes(2);
    expect(recent.request()).toBeNull();
  });

  it('gives up without calling again when not confirmed', async () => {
    const call = vi.fn().mockRejectedValue(needsSignIn());
    const result = recent.run(call);
    await vi.waitFor(() => expect(recent.request()).not.toBeNull());

    recent.request()!.done(false);

    await expect(result).rejects.toMatchObject({ status: 403, message: NOT_CONFIRMED });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
