import { describe, expect, it, vi } from 'vitest';

import * as functions from './index';
import { ping } from './index';

describe('ping', () => {
  it('responds with ok', async () => {
    const json = vi.fn();
    const [request, response] = [{}, { json }] as unknown as Parameters<typeof ping>;

    await ping(request, response);

    expect(json).toHaveBeenCalledWith({ ok: true });
  });
});

describe('every function', () => {
  it.each(Object.entries(functions))('%s is capped at 10 instances', (_name, fn) => {
    expect((fn as { __endpoint: { maxInstances?: number } }).__endpoint.maxInstances).toBe(10);
  });
});
