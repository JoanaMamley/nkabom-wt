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
 * Makes a scheduled job (NKB-110). Only backupFirestore still uses it, until NKB-119 and NKB-120
 * replace it; new scheduled work is a task in the Worker (worker/src/jobs.ts, NKB-118). Use it
 * instead of onSchedule, for example:
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
