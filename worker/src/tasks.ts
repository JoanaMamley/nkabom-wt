import type { Env } from './env';
import type { Schedule } from './jobs';

// What a scheduled task is (NKB-118), kept apart from jobs.ts so tasks in other files, such as
// backups.ts, can import it without importing the schedule that lists them.

/**
 * A piece of periodic work. It may be run again after failing part-way, so it must skip work that
 * is already done. Work too big for one invocation, such as a backup, does a batch and returns
 * continueTask(...): the queue then runs step with what it was given, one batch per invocation,
 * until a step returns without continuing. Each step is retried on its own, and the task's status
 * is recorded when the last step finishes or a step fails every attempt.
 */
export interface Task {
  name: string;
  run: (env: Env, run: JobRun) => Promise<TaskResult>;
  step?: (env: Env, run: JobRun, step: unknown) => Promise<TaskResult>;
}

/** Which run of which task a message belongs to. */
export interface JobRun {
  schedule: Schedule;
  task: string;
  /** When the trigger fired, in milliseconds. */
  scheduledTime: number;
}

/** What continueTask returns: the run goes on in a queued step. */
export const CONTINUES = Symbol('continues');
export type TaskResult = void | typeof CONTINUES;

/** Queues the next step of a run, and returns what the task should return. */
export async function continueTask(env: Env, run: JobRun, step: unknown): Promise<TaskResult> {
  const { schedule, task, scheduledTime } = run;
  await env.JOBS.send({ type: 'step', schedule, task, scheduledTime, step });
  return CONTINUES;
}

/** A message on the JOBS queue: the start of a task's run, or a later step of it. */
export interface JobMessage extends JobRun {
  type: 'task' | 'step';
  /** Only for a step: what the previous step passed to continueTask. */
  step?: unknown;
}
