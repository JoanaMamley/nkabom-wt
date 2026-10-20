import { Message } from 'firebase-functions/v2/pubsub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { error, info } = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ error, info, warn: vi.fn() }));

import { type BillingApi, capBilling, cloudBilling, enforceBudget } from './costs';

function budget(costAmount: number, budgetAmount = 1.5) {
  return { budgetDisplayName: 'nkabom-prod', costAmount, budgetAmount, currencyCode: 'USD' };
}

function billing(enabled = true): BillingApi & { disable: ReturnType<typeof vi.fn> } {
  return { isEnabled: vi.fn().mockResolvedValue(enabled), disable: vi.fn() };
}

beforeEach(() => {
  error.mockReset();
  info.mockReset();
});

describe('capBilling', () => {
  it('leaves billing on while spend is under the budget', async () => {
    const api = billing();

    expect(await capBilling(api, 'nkabom-prod', budget(1.49))).toBe(false);
    expect(api.isEnabled).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('turns billing off once spend reaches the budget, and logs it as an error', async () => {
    const api = billing();

    expect(await capBilling(api, 'nkabom-prod', budget(1.5))).toBe(true);
    expect(api.disable).toHaveBeenCalledWith('nkabom-prod');
    expect(error).toHaveBeenCalledWith('Budget reached: billing turned off', {
      project: 'nkabom-prod',
      budget: 'nkabom-prod',
      cost: 1.5,
      limit: 1.5,
      currency: 'USD',
    });
  });

  it('does nothing more when billing is already off', async () => {
    const api = billing(false);

    expect(await capBilling(api, 'nkabom-prod', budget(3))).toBe(false);
    expect(api.disable).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      'Budget reached, billing already off',
      expect.objectContaining({ project: 'nkabom-prod' }),
    );
  });

  it('ignores a notification without amounts', async () => {
    const api = billing();

    expect(await capBilling(api, 'nkabom-prod', {} as never)).toBe(false);
    expect(await capBilling(api, 'nkabom-prod', null)).toBe(false);
    expect(api.disable).not.toHaveBeenCalled();
  });

  it('fails when billing cannot be turned off, so the notification is retried', async () => {
    const api = billing();
    api.disable.mockRejectedValue(new Error('PERMISSION_DENIED'));

    await expect(capBilling(api, 'nkabom-prod', budget(2))).rejects.toThrow('PERMISSION_DENIED');
  });
});

describe('enforceBudget', () => {
  const env = { FIREBASE_CONFIG: JSON.stringify({ projectId: 'nkabom-staging' }) };

  beforeEach(() => Object.assign(process.env, env));
  afterEach(() => {
    Object.keys(env).forEach((name) => delete process.env[name]);
    vi.restoreAllMocks();
  });

  function message(data: string) {
    const payload = { messageId: '1', data: Buffer.from(data).toString('base64') };
    return { data: { message: new Message(payload) } } as unknown as Parameters<
      typeof enforceBudget.run
    >[0];
  }

  it("caps this project's billing from the budget notification", async () => {
    vi.spyOn(cloudBilling, 'isEnabled').mockResolvedValue(true);
    const disable = vi.spyOn(cloudBilling, 'disable').mockResolvedValue();

    await enforceBudget.run(message(JSON.stringify(budget(0.6, 0.5))));

    expect(disable).toHaveBeenCalledWith('nkabom-staging');
  });

  it('drops a message that is not JSON instead of retrying it', async () => {
    const disable = vi.spyOn(cloudBilling, 'disable');

    await enforceBudget.run(message('not json'));

    expect(disable).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Budget notification is not JSON', { messageId: '1' });
  });

  it('listens on the budget topic and is retried when it fails', () => {
    expect(enforceBudget.__endpoint.eventTrigger).toMatchObject({
      eventFilters: { topic: 'budget-alerts' },
      retry: true,
    });
  });
});
