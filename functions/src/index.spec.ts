import { describe, expect, it, vi } from 'vitest';

import { ping } from './index';

describe('ping', () => {
  it('responds with ok', async () => {
    const json = vi.fn();
    const [request, response] = [{}, { json }] as unknown as Parameters<typeof ping>;

    await ping(request, response);

    expect(json).toHaveBeenCalledWith({ ok: true });
  });
});
