import { defineBoolean } from 'firebase-functions/params';
import { error, info } from 'firebase-functions/logger';
import {
  onSchedule,
  type ScheduledEvent,
  type ScheduleOptions,
} from 'firebase-functions/v2/scheduler';

/** Schedules are read in Ghana time, so "every day 08:00" means 08:00 for members. */
export const JOB_TIME_ZONE = 'Africa/Accra';

// Cloud Scheduler retries a failed run 3 times, waiting 1, 2 and then 4 minutes.
export const JOB_RETRY = { retryCount: 3, minBackoffSeconds: 60, maxBackoffSeconds: 600 };

export type JobOptions = Omit<ScheduleOptions, 'timeZone'>;

/**
 * Makes a scheduled job (NKB-110) for reminders, calendar sync and the like. Use it instead of
 * onSchedule, for example:
 *
 *   export const sendReminders = scheduledJob('sendReminders', { schedule: 'every day 08:00' },
 *     async () => { ... });
 *
 * Each run is logged as "Scheduled job finished" or "Scheduled job failed", with the job name and
 * the scheduled time, which a retry keeps. A failed run is retried (JOB_RETRY, unless the options
 * say otherwise), so the handler must be safe to run again after failing part-way: skip work that
 * is already done rather than repeating it.
 */
export function scheduledJob(
  name: string,
  options: JobOptions,
  handler: (event: ScheduledEvent) => Promise<void>,
) {
  return onSchedule({ timeZone: JOB_TIME_ZONE, ...JOB_RETRY, ...options }, async (event) => {
    const run = { job: name, scheduleTime: event.scheduleTime };
    const started = Date.now();

    try {
      await handler(event);
    } catch (cause) {
      error('Scheduled job failed', {
        ...run,
        durationMs: Date.now() - started,
        error: cause instanceof Error ? cause.message : String(cause),
        stack: cause instanceof Error ? cause.stack : undefined,
      });
      // Failing the run is what makes Cloud Scheduler retry it.
      throw cause;
    }

    info('Scheduled job finished', { ...run, durationMs: Date.now() - started });
  });
}

// Set to true in a project's functions/.env file to see retries and error logs, then set it back.
const heartbeatFail = defineBoolean('HEARTBEAT_FAIL', { default: false });

/**
 * Sample job: does nothing but succeed, so a missing "Scheduled job finished" for it in the logs
 * means scheduled jobs are not running. HEARTBEAT_FAIL makes it fail instead, to check retries.
 */
export const schedulerHeartbeat = scheduledJob(
  'schedulerHeartbeat',
  { schedule: 'every day 06:00' },
  async () => {
    if (heartbeatFail.value()) {
      throw new Error('Heartbeat failed on purpose (HEARTBEAT_FAIL is true)');
    }
  },
);
