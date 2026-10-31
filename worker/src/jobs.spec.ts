import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import type { FakeFirestore } from './fake-firestore';
import worker from './index';
import { type JobMessage, MAX_ATTEMPTS, retryDelaySeconds, SCHEDULES, type Task } from './jobs';
import { emulatorEnv, mockEmulators } from './test-helpers';

const DAILY = SCHEDULES.daily.cron;
const FREQUENT = SCHEDULES.frequent.cron;
const fired = new Date('2026-10-23T02:00:00Z');

let firestore: FakeFirestore;
let log: ReturnType<typeof vi.spyOn>;
let logError: ReturnType<typeof vi.spyOn>;

// A task for these tests, in both schedules: it succeeds, or fails when its env has fail set.
const sampleTask: Task = {
  name: 'sample',
  async run(env) {
    if ((env as Env & { fail?: boolean }).fail) {
      throw new Error('Sample task failed on purpose');
    }
  },
};

beforeEach(() => {
  SCHEDULES.daily.tasks.push(sampleTask);
  SCHEDULES.frequent.tasks.push(sampleTask);
  ({ firestore } = mockEmulators());
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const { tasks } of Object.values(SCHEDULES)) {
    if (tasks.includes(sampleTask)) {
      tasks.splice(tasks.indexOf(sampleTask), 1);
    }
  }
});

function jobsEnv({ fail = false, ...overrides }: Partial<Env> & { fail?: boolean } = {}) {
  const sendBatch = vi.fn();
  const env = Object.assign(
    emulatorEnv({
      EMAIL_PROVIDER: 'log',
      JOBS: { sendBatch, send: vi.fn() } as unknown as Queue<JobMessage>,
      ...overrides,
    }),
    { fail },
  );
  return { env, sendBatch };
}

async function trigger(cron: string, env: Env) {
  const controller = createScheduledController({ cron, scheduledTime: fired });
  await worker.scheduled(controller, env);
}

function message(
  attempts: number,
  task = 'sample',
  schedule = 'daily',
): JobMessage & {
  attempts: number;
} {
  return { type: 'task', schedule, task, scheduledTime: fired.getTime(), attempts } as never;
}

// Runs the queue consumer on messages and returns what it did with each.
async function consume(env: Env, ...messages: ReturnType<typeof message>[]) {
  const batch = createMessageBatch<JobMessage>(
    'nkabom-jobs',
    messages.map(({ attempts, ...body }, i) => ({
      id: `msg${i}`,
      timestamp: fired,
      attempts,
      body: body as JobMessage,
    })),
  );
  // getQueueResult leaves out a retry's delay, so it is read from the calls instead.
  const retries = batch.messages.map((m) => vi.spyOn(m, 'retry'));
  const ctx = createExecutionContext();
  await worker.queue(batch, env);
  const result = await getQueueResult(batch, ctx);
  return {
    explicitAcks: result.explicitAcks,
    retryMessages: retries.flatMap((retry, i) =>
      retry.mock.calls.map(([options]) => ({ msgId: `msg${i}`, ...options })),
    ),
  };
}

const status = (id = 'daily-sample') => firestore.docs.get(`jobStatus/${id}`);
const emailsSent = () =>
  log.mock.calls.filter(([text]: unknown[]) => text === 'Email not sent (EMAIL_PROVIDER=log)');

describe('Cron Triggers', () => {
  it.each([
    ['daily', DAILY],
    ['frequent', FREQUENT],
  ])('queue each %s task with the time the trigger fired', async (schedule, cron) => {
    const { env, sendBatch } = jobsEnv();
    const tasks = SCHEDULES[schedule as keyof typeof SCHEDULES].tasks.map(({ name }) => name);

    await trigger(cron, env);

    expect(sendBatch).toHaveBeenCalledWith(
      tasks.map((task) => ({
        body: { type: 'task', schedule, task, scheduledTime: fired.getTime() },
      })),
    );
    expect(log).toHaveBeenCalledWith('Scheduled tasks queued', {
      schedule,
      tasks,
      scheduledTime: '2026-10-23T02:00:00.000Z',
    });
  });

  it('runs only the backup each day, and nothing every 5 minutes yet', () => {
    const names = (schedule: keyof typeof SCHEDULES) =>
      SCHEDULES[schedule].tasks.filter((task) => task !== sampleTask).map(({ name }) => name);

    expect(names('daily')).toEqual(['backupFirestore']);
    expect(names('frequent')).toEqual([]);
  });

  it('queues nothing for a trigger with no tasks', async () => {
    SCHEDULES.frequent.tasks.splice(SCHEDULES.frequent.tasks.indexOf(sampleTask), 1);
    const { env, sendBatch } = jobsEnv();

    await trigger(FREQUENT, env);

    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('logs a cron with no schedule and queues nothing', async () => {
    const { env, sendBatch } = jobsEnv();

    await trigger('0 3 * * *', env);

    expect(sendBatch).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('Unknown cron trigger', { cron: '0 3 * * *' });
  });

  it('fails the trigger when the tasks cannot be queued, so the failure is logged', async () => {
    const { env, sendBatch } = jobsEnv();
    sendBatch.mockRejectedValue(new Error('Queue unavailable'));

    await expect(trigger(DAILY, env)).rejects.toThrow('Queue unavailable');
  });
});

describe('queued tasks', () => {
  it('runs the task, acknowledges it and records its success', async () => {
    const { env } = jobsEnv();

    const result = await consume(env, message(1));

    expect(result.explicitAcks).toEqual(['msg0']);
    expect(result.retryMessages).toEqual([]);
    expect(log).toHaveBeenCalledWith('Scheduled task finished', {
      schedule: 'daily',
      task: 'sample',
      scheduledTime: '2026-10-23T02:00:00.000Z',
      attempt: 1,
      durationMs: expect.any(Number),
    });
    expect(status()).toEqual({
      schedule: 'daily',
      task: 'sample',
      status: 'succeeded',
      scheduledTime: fired,
      finishedAt: firestore.now,
      attempt: 1,
      error: null,
      lastSucceededAt: firestore.now,
      consecutiveFailures: 0,
      alertedAt: null,
    });
  });

  it('keeps each schedule’s status apart', async () => {
    const { env } = jobsEnv();

    await consume(env, message(1, 'sample', 'frequent'));

    expect(status('frequent-sample')).toMatchObject({ status: 'succeeded' });
    expect(status('daily-sample')).toBeUndefined();
  });

  it('retries a failed task after a delay, and logs and records the failure', async () => {
    const { env } = jobsEnv({ fail: true });

    const result = await consume(env, message(1));

    expect(result.retryMessages).toEqual([{ msgId: 'msg0', delaySeconds: 60 }]);
    expect(result.explicitAcks).toEqual([]);
    expect(logError).toHaveBeenCalledWith('Scheduled task failed', {
      schedule: 'daily',
      task: 'sample',
      scheduledTime: '2026-10-23T02:00:00.000Z',
      attempt: 1,
      durationMs: expect.any(Number),
      willRetry: true,
      error: 'Sample task failed on purpose',
      stack: expect.stringContaining('Sample task failed on purpose'),
    });
    expect(status()).toMatchObject({
      status: 'retrying',
      attempt: 1,
      error: 'Sample task failed on purpose',
      consecutiveFailures: 0,
    });
    expect(emailsSent()).toEqual([]);
  });

  it('waits 1, 2 and then 4 minutes between attempts', async () => {
    const { env } = jobsEnv({ fail: true });

    for (const attempt of [1, 2, 3]) {
      const result = await consume(env, message(attempt));
      expect(result.retryMessages[0].delaySeconds).toBe(retryDelaySeconds(attempt));
    }
    expect([1, 2, 3].map(retryDelaySeconds)).toEqual([60, 120, 240]);
  });

  describe('after the last attempt fails', () => {
    beforeEach(() => {
      firestore.docs.set('users/efua', { role: 'primaryAdmin', email: 'efua@example.com' });
      firestore.docs.set('users/kojo', { role: 'primaryAdmin', email: 'kojo@example.com' });
      firestore.docs.set('users/ama', { role: 'member', email: 'ama@example.com' });
    });

    it('stops retrying and records the run as failed', async () => {
      const { env } = jobsEnv({ fail: true });

      const result = await consume(env, message(MAX_ATTEMPTS));

      expect(result.explicitAcks).toEqual(['msg0']);
      expect(result.retryMessages).toEqual([]);
      expect(logError).toHaveBeenCalledWith(
        'Scheduled task failed',
        expect.objectContaining({ attempt: 4, willRetry: false }),
      );
      expect(status()).toMatchObject({ status: 'failed', attempt: 4, consecutiveFailures: 1 });
    });

    it('emails every Primary Admin once, and not again until the task succeeds', async () => {
      const { env } = jobsEnv({ fail: true });

      await consume(env, message(MAX_ATTEMPTS));

      expect(emailsSent().map(([, email]: unknown[]) => email)).toEqual([
        expect.objectContaining({
          to: 'efua@example.com',
          subject: 'Nkabom scheduled task failed: sample',
          text: expect.stringContaining('Sample task failed on purpose'),
        }),
        expect.objectContaining({ to: 'kojo@example.com' }),
      ]);
      expect(status()).toMatchObject({ alertedAt: firestore.now });

      // The next day's run fails too: recorded, but no second email.
      await consume(env, message(MAX_ATTEMPTS));
      expect(emailsSent()).toHaveLength(2);
      expect(status()).toMatchObject({ consecutiveFailures: 2, alertedAt: firestore.now });

      // It recovers, then fails again: a new email.
      await consume(jobsEnv().env, message(1));
      expect(status()).toMatchObject({ consecutiveFailures: 0, alertedAt: null });
      await consume(env, message(MAX_ATTEMPTS));
      expect(emailsSent()).toHaveLength(4);
    });

    it('emails the shared project account while there is no Primary Admin', async () => {
      firestore.docs.delete('users/efua');
      firestore.docs.delete('users/kojo');
      const { env } = jobsEnv({ fail: true, GMAIL_USER: 'project@example.com' });

      await consume(env, message(MAX_ATTEMPTS));

      expect(emailsSent().map(([, email]: unknown[]) => email)).toEqual([
        expect.objectContaining({ to: 'project@example.com' }),
      ]);
    });

    it('logs when there is no one to tell, and tries again on the next failure', async () => {
      firestore.docs.delete('users/efua');
      firestore.docs.delete('users/kojo');
      const { env } = jobsEnv({ fail: true });

      await consume(env, message(MAX_ATTEMPTS));

      expect(logError).toHaveBeenCalledWith('No one to tell about a failed scheduled task', {
        schedule: 'daily',
        task: 'sample',
      });
      expect(status()).toMatchObject({ status: 'failed', alertedAt: null });
    });
  });

  it('retries one failing task without holding up the others', async () => {
    const { env } = jobsEnv();
    vi.spyOn(sampleTask, 'run').mockRejectedValueOnce(new Error('Calendar API answered 503'));

    const result = await consume(env, message(1), message(1, 'sample', 'frequent'));

    expect(result.retryMessages).toEqual([{ msgId: 'msg0', delaySeconds: 60 }]);
    expect(result.explicitAcks).toEqual(['msg1']);
  });

  it('acknowledges a message for a task that no longer exists', async () => {
    const { env } = jobsEnv();

    const result = await consume(env, message(1, 'removedTask'));

    expect(result.explicitAcks).toEqual(['msg0']);
    expect(logError).toHaveBeenCalledWith(
      'Scheduled task not found',
      expect.objectContaining({ task: 'removedTask' }),
    );
  });

  it('still acknowledges a finished task when its status cannot be saved', async () => {
    const { env } = jobsEnv();
    firestore.abortCommits = 5;

    const result = await consume(env, message(1));

    expect(result.explicitAcks).toEqual(['msg0']);
    expect(logError).toHaveBeenCalledWith(
      'Scheduled task status not saved',
      expect.objectContaining({ task: 'sample', status: 'succeeded' }),
    );
  });
});
