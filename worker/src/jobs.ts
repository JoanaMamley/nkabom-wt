import { backupTask } from './backups';
import { sendEmail } from './email';
import type { Env } from './env';
import { findDocuments, runTransaction, SERVER_TIME, WriteBatch, commit } from './firestore';
import { JOB_STATUS, type JobOutcome, USERS } from './model';
import { CONTINUES, type JobMessage, type JobRun, type Task, type TaskResult } from './tasks';

export { continueTask, type JobMessage, type Task } from './tasks';

// Scheduled jobs (NKB-118). Two Cron Triggers per environment, daily and every 5 minutes (the free
// plan allows 5 per account), each queue one message per task on the JOBS queue. The queue runs
// each task in its own invocation, so tasks get their own time and subrequest limits, and one
// failing does not stop the others; a failed task is tried again with growing delays.

/**
 * The tasks each trigger runs. Cron times are UTC, which is also Ghana time. Each cron must match
 * the triggers in wrangler.jsonc. Daily tasks (backups, NKB-308, NKB-512, NKB-707) go in
 * daily; frequent is for checks that cannot wait a day, and each run of each task costs 3 of the
 * account's 10,000 queue operations a day, about 860 a day per frequent task in each environment.
 */
export const SCHEDULES = {
  daily: { cron: '0 2 * * *', tasks: [backupTask] as Task[] },
  // Nothing needs it yet; a trigger with no tasks queues nothing, so it costs nothing.
  frequent: { cron: '*/5 * * * *', tasks: [] as Task[] },
} satisfies Record<string, { cron: string; tasks: Task[] }>;
export type Schedule = keyof typeof SCHEDULES;

/** A failed task is tried this many times in all, waiting 1, 2 and then 4 minutes between. */
export const MAX_ATTEMPTS = 4;

export function retryDelaySeconds(attempt: number): number {
  return 60 * 2 ** (attempt - 1);
}

/** The Cron Trigger handler: queues each of the schedule's tasks. */
export async function queueScheduledTasks(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const entry = Object.entries(SCHEDULES).find(([, { cron }]) => cron === controller.cron);
  if (!entry) {
    console.error('Unknown cron trigger', { cron: controller.cron });
    return;
  }
  const [schedule, { tasks }] = entry as [Schedule, { tasks: Task[] }];
  if (tasks.length === 0) {
    return;
  }
  await env.JOBS.sendBatch(
    tasks.map((task) => ({
      body: {
        type: 'task' as const,
        schedule,
        task: task.name,
        scheduledTime: controller.scheduledTime,
      },
    })),
  );
  console.log('Scheduled tasks queued', {
    schedule,
    tasks: tasks.map((task) => task.name),
    scheduledTime: new Date(controller.scheduledTime).toISOString(),
  });
}

/** The queue consumer: runs each message's task, retrying a failure until MAX_ATTEMPTS. */
export async function runJobMessages(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    await runTaskMessage(message, env);
  }
}

async function runTaskMessage(message: Message<JobMessage>, env: Env): Promise<void> {
  const { type, schedule, task: name, scheduledTime } = message.body;
  const run = {
    schedule,
    task: name,
    scheduledTime: new Date(scheduledTime).toISOString(),
    attempt: message.attempts,
    ...(type === 'step' && { step: true }),
  };
  const task: Task | undefined = SCHEDULES[schedule]?.tasks.find(
    (candidate: Task) => candidate.name === name,
  );
  if (!task || (type === 'step' && !task.step)) {
    // Removed since the message was queued.
    console.error('Scheduled task not found', run);
    message.ack();
    return;
  }

  const jobRun: JobRun = { schedule, task: name, scheduledTime };
  const started = Date.now();
  let result: TaskResult;
  try {
    result =
      type === 'step'
        ? await task.step!(env, jobRun, message.body.step)
        : await task.run(env, jobRun);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    const retry = message.attempts < MAX_ATTEMPTS;
    console.error('Scheduled task failed', {
      ...run,
      durationMs: Date.now() - started,
      willRetry: retry,
      error,
      stack: cause instanceof Error ? cause.stack : undefined,
    });
    if (retry) {
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      await saveStatus(env, message.body, message.attempts, 'retrying', error);
    } else {
      message.ack();
      await saveStatus(env, message.body, message.attempts, 'failed', error);
    }
    return;
  }

  if (result === CONTINUES) {
    console.log('Scheduled task continues', { ...run, durationMs: Date.now() - started });
    message.ack();
    return;
  }
  console.log('Scheduled task finished', { ...run, durationMs: Date.now() - started });
  message.ack();
  await saveStatus(env, message.body, message.attempts, 'succeeded', null);
}

/**
 * Records the run in jobStatus, and after a run that failed every attempt, emails the Primary
 * Admins, once until the task succeeds again. Its own failures are logged, not thrown, so they
 * never change whether the task is retried.
 */
async function saveStatus(
  env: Env,
  { schedule, task, scheduledTime }: JobMessage,
  attempt: number,
  status: JobOutcome,
  error: string | null,
): Promise<void> {
  const path = `${JOB_STATUS}/${schedule}-${task}`;
  try {
    const alert = await runTransaction(env, async (tx) => {
      const [current] = await tx.getAll(path);
      const failures = Number(current?.['consecutiveFailures'] ?? 0);
      const alertedAt = (current?.['alertedAt'] as Date | null | undefined) ?? null;
      tx.set(path, {
        schedule,
        task,
        status,
        scheduledTime: new Date(scheduledTime),
        finishedAt: SERVER_TIME,
        attempt,
        error,
        lastSucceededAt:
          status === 'succeeded' ? SERVER_TIME : ((current?.['lastSucceededAt'] as Date) ?? null),
        consecutiveFailures: status === 'succeeded' ? 0 : failures + (status === 'failed' ? 1 : 0),
        alertedAt: status === 'succeeded' ? null : alertedAt,
      });
      return status === 'failed' && !alertedAt;
    });

    if (alert && (await alertAdmins(env, schedule, task, attempt, error ?? ''))) {
      const batch = new WriteBatch();
      batch.update(path, { alertedAt: SERVER_TIME });
      await commit(env, batch);
    }
  } catch (cause) {
    console.error('Scheduled task status not saved', {
      schedule,
      task,
      status,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Emails every Primary Admin, or the shared project account (GMAIL_USER) while there is none, as
 * before the first one is set up (NKB-207). True if at least one email was sent.
 */
async function alertAdmins(
  env: Env,
  schedule: string,
  task: string,
  attempts: number,
  error: string,
): Promise<boolean> {
  const admins = await findDocuments(env, USERS, 'role', 'primaryAdmin');
  const emails = [...admins.values()]
    .map((admin) => admin['email'])
    .filter((email): email is string => typeof email === 'string' && email !== '');
  if (emails.length === 0 && env.GMAIL_USER) {
    emails.push(env.GMAIL_USER);
  }
  if (emails.length === 0) {
    console.error('No one to tell about a failed scheduled task', { schedule, task });
    return false;
  }

  let sent = false;
  for (const email of emails) {
    try {
      await sendEmail(env, { email }, 'jobFailed', {
        task,
        schedule,
        attempts,
        // Long errors, such as a whole HTTP answer, are cut short.
        error: error.slice(0, 500),
      });
      sent = true;
    } catch {
      // sendEmail has logged why; the other admins are still told.
    }
  }
  return sent;
}
