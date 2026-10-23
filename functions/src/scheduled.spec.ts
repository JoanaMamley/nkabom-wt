import type { ScheduledEvent } from 'firebase-functions/v2/scheduler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { error, info } = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ error, info, warn: vi.fn() }));

import { JOB_RETRY, scheduledJob } from './scheduled';

const event: ScheduledEvent = { scheduleTime: '2026-10-21T06:00:00Z' };
const noop = () => Promise.resolve();

beforeEach(() => {
  error.mockReset();
  info.mockReset();
});

describe('scheduledJob', () => {
  it('runs the handler and logs the finished run', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const job = scheduledJob('sample', { schedule: 'every day 08:00' }, handler);

    await job.run(event);

    expect(handler).toHaveBeenCalledWith(event);
    expect(info).toHaveBeenCalledWith('Scheduled job finished', {
      job: 'sample',
      scheduleTime: '2026-10-21T06:00:00Z',
      durationMs: expect.any(Number),
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a failed run and fails it, so Cloud Scheduler retries', async () => {
    const job = scheduledJob('sample', { schedule: 'every day 08:00' }, async () => {
      throw new Error('Calendar API answered 503');
    });

    await expect(job.run(event)).rejects.toThrow('Calendar API answered 503');

    expect(error).toHaveBeenCalledWith('Scheduled job failed', {
      job: 'sample',
      scheduleTime: '2026-10-21T06:00:00Z',
      durationMs: expect.any(Number),
      error: 'Calendar API answered 503',
      stack: expect.stringContaining('Calendar API answered 503'),
    });
    expect(info).not.toHaveBeenCalled();
  });

  it('logs a thrown value that is not an Error', async () => {
    const job = scheduledJob('sample', { schedule: 'every day 08:00' }, () =>
      Promise.reject('quota exceeded'),
    );

    await expect(job.run(event)).rejects.toBe('quota exceeded');

    expect(error).toHaveBeenCalledWith(
      'Scheduled job failed',
      expect.objectContaining({ error: 'quota exceeded', stack: undefined }),
    );
  });

  it('runs on Accra time and retries by default', () => {
    const job = scheduledJob('sample', { schedule: 'every day 08:00' }, noop);

    expect(job.__endpoint.scheduleTrigger).toMatchObject({
      schedule: 'every day 08:00',
      timeZone: 'Africa/Accra',
      retryConfig: JOB_RETRY,
    });
  });

  it('lets a job set its own retries', () => {
    const job = scheduledJob('sample', { schedule: 'every 5 minutes', retryCount: 0 }, noop);

    expect(job.__endpoint.scheduleTrigger).toMatchObject({ retryConfig: { retryCount: 0 } });
  });
});
