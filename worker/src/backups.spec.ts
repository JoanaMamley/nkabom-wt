import { env as bindings } from 'cloudflare:workers';
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACKUP_TTL_SECONDS, LATEST_KEY, PAGE_SIZE } from './backups';
import type { Env } from './env';
import type { FakeFirestore } from './fake-firestore';
import { encodeFields } from './firestore';
import worker from './index';
import type { JobMessage } from './tasks';
import { emulatorEnv, mockEmulators } from './test-helpers';

// The local BACKUPS namespace from wrangler.jsonc.
const { BACKUPS } = bindings as unknown as Env;

let firestore: FakeFirestore;
let queued: JobMessage[];
let env: Env;

beforeEach(async () => {
  ({ firestore } = mockEmulators());
  queued = [];
  env = emulatorEnv({
    BACKUPS,
    JOBS: { send: vi.fn(async (body: JobMessage) => void queued.push(body)) } as never,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const { name } of (await BACKUPS.list()).keys) {
    await BACKUPS.delete(name);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const day1 = Date.parse('2026-10-24T02:00:00Z');
const day2 = Date.parse('2026-10-25T02:00:00Z');

async function consume(body: JobMessage, attempts = 1) {
  const batch = createMessageBatch<JobMessage>('nkabom-jobs', [
    { id: 'msg', timestamp: new Date(), attempts, body },
  ]);
  const retry = vi.spyOn(batch.messages[0], 'retry');
  const ctx = createExecutionContext();
  await worker.queue(batch, env);
  const { explicitAcks } = await getQueueResult(batch, ctx);
  return { acked: explicitAcks.length > 0, retried: retry.mock.calls.length > 0 };
}

// Runs the daily backup task, then each step it queues, as the queue would. Returns the number of
// invocations it took.
async function backup(scheduledTime = day1) {
  let invocations = 1;
  await consume({ type: 'task', schedule: 'daily', task: 'backupFirestore', scheduledTime });
  while (queued.length > 0) {
    await consume(queued.shift()!);
    invocations++;
  }
  return invocations;
}

async function page(key: string) {
  return (await BACKUPS.get(key, 'json')) as { path: string; fields: unknown }[];
}

function seedMembers(count: number) {
  for (let i = 0; i < count; i++) {
    firestore.docs.set(`members/m${String(i).padStart(3, '0')}`, {
      surname: `Member ${i}`,
      graduationYear: 2000 + (i % 20),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    });
  }
}

function seedAudit(
  count: number,
  from = 0,
  at = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, i)),
) {
  for (let i = from; i < from + count; i++) {
    firestore.docs.set(`auditLog/e${String(i).padStart(4, '0')}`, {
      action: 'member.edit',
      at: at(i),
    });
  }
}

describe('backupFirestore', () => {
  it('backs up every collection a page at a time, one page per invocation', async () => {
    seedMembers(250);
    firestore.docs.set('users/ama', { role: 'member' });
    firestore.docs.set('jobStatus/daily-sample', { status: 'succeeded' });

    const invocations = await backup();

    const id = '2026-10-24T02:00:00Z';
    expect((await page(`firestore/${id}/members/0000`)).length).toBe(PAGE_SIZE);
    expect((await page(`firestore/${id}/members/0001`)).length).toBe(PAGE_SIZE);
    expect((await page(`firestore/${id}/members/0002`)).length).toBe(50);
    expect(await page(`firestore/${id}/users/0000`)).toHaveLength(1);
    expect(await page(`firestore/${id}/jobStatus/0000`)).toHaveLength(1);
    // members 3 pages, users 1, jobStatus 1 (written by this run's own status too).
    expect(invocations).toBe(5);
    expect(await BACKUPS.get(`firestore/${id}/manifest`, 'json')).toEqual({
      backupId: id,
      finishedAt: expect.any(String),
      documents: { jobStatus: 1, members: 250, users: 1 },
      auditLog: { after: null, through: null },
    });
  });

  it('keeps each document exactly as Firestore gave it, so a restore writes back the same', async () => {
    seedMembers(3);

    await backup();

    expect(await page('firestore/2026-10-24T02:00:00Z/members/0000')).toEqual(
      [...firestore.docs]
        .filter(([path]) => path.startsWith('members/'))
        .map(([path, fields]) => ({ path, fields: encodeFields(fields) })),
    );
    // Whole numbers stay integers and times stay timestamps.
    expect((await page('firestore/2026-10-24T02:00:00Z/members/0000'))[0].fields).toMatchObject({
      graduationYear: { integerValue: '2000' },
      createdAt: { timestampValue: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('keeps backups 30 days, and the audit log and the latest pointer for good', async () => {
    seedMembers(1);
    seedAudit(1);

    await backup();

    const { keys } = await BACKUPS.list();
    const expiry = Object.fromEntries(keys.map(({ name, expiration }) => [name, expiration]));
    const in30Days = Date.now() / 1000 + BACKUP_TTL_SECONDS;
    expect(expiry['firestore/2026-10-24T02:00:00Z/members/0000']).toBeCloseTo(in30Days, -2);
    expect(expiry['firestore/2026-10-24T02:00:00Z/manifest']).toBeCloseTo(in30Days, -2);
    expect(expiry['auditLog/2026-10-24T02:00:00Z/0000']).toBeUndefined();
    expect(expiry[LATEST_KEY]).toBeUndefined();
  });

  it('backs up only the audit entries added since the last backup', async () => {
    seedAudit(3);
    await backup(day1);
    seedAudit(2, 3);

    await backup(day2);

    expect((await page('auditLog/2026-10-25T02:00:00Z/0000')).map(({ path }) => path)).toEqual([
      'auditLog/e0003',
      'auditLog/e0004',
    ]);
    expect(await BACKUPS.get('firestore/2026-10-25T02:00:00Z/manifest', 'json')).toMatchObject({
      documents: { auditLog: 2 },
      auditLog: {
        after: { path: 'auditLog/e0002', time: '2026-10-01T00:02:00.000Z' },
        through: { path: 'auditLog/e0004', time: '2026-10-01T00:04:00.000Z' },
      },
    });
    expect(await BACKUPS.get(LATEST_KEY, 'json')).toEqual({
      backupId: '2026-10-25T02:00:00Z',
      auditCursor: { path: 'auditLog/e0004', time: '2026-10-01T00:04:00.000Z' },
    });
  });

  it('takes each audit entry once across pages, even when several share a time', async () => {
    // 250 entries, ten to each second.
    seedAudit(250, 0, (i) => new Date(Date.UTC(2026, 9, 1, 0, 0, Math.floor(i / 10))));

    await backup();

    const keys = (await BACKUPS.list({ prefix: 'auditLog/' })).keys.map(({ name }) => name);
    const paths = (await Promise.all(keys.map(page))).flat().map(({ path }) => path);
    expect(keys).toHaveLength(3);
    expect(paths).toHaveLength(250);
    expect(new Set(paths).size).toBe(250);
  });

  it('writes nothing for an empty audit log since the last backup', async () => {
    seedAudit(1);
    await backup(day1);

    await backup(day2);

    expect((await BACKUPS.list({ prefix: 'auditLog/2026-10-25' })).keys).toEqual([]);
    expect(await BACKUPS.get(LATEST_KEY, 'json')).toMatchObject({
      auditCursor: { path: 'auditLog/e0000' },
    });
  });

  it('records the run as succeeded only when the last page is written', async () => {
    seedMembers(150);

    await consume({
      type: 'task',
      schedule: 'daily',
      task: 'backupFirestore',
      scheduledTime: day1,
    });
    expect(firestore.docs.has('jobStatus/daily-backupFirestore')).toBe(false);

    while (queued.length > 0) {
      await consume(queued.shift()!);
    }
    expect(firestore.docs.get('jobStatus/daily-backupFirestore')).toMatchObject({
      status: 'succeeded',
    });
  });

  it('retries a failed page on its own, and moves on only when it is written', async () => {
    seedMembers(150);
    await consume({
      type: 'task',
      schedule: 'daily',
      task: 'backupFirestore',
      scheduledTime: day1,
    });
    const second = queued.shift()!;
    vi.spyOn(BACKUPS, 'put').mockRejectedValueOnce(new Error('KV unavailable'));

    const result = await consume(second);

    expect(result).toEqual({ acked: false, retried: true });
    expect(queued).toEqual([]);
    expect(firestore.docs.get('jobStatus/daily-backupFirestore')).toMatchObject({
      status: 'retrying',
      error: 'KV unavailable',
    });
    expect(await BACKUPS.get(LATEST_KEY)).toBeNull();

    // The retry, with the same step, finishes the backup.
    await consume(second, 2);
    while (queued.length > 0) {
      await consume(queued.shift()!);
    }
    expect((await page('firestore/2026-10-24T02:00:00Z/members/0001')).length).toBe(50);
    expect(await BACKUPS.get(LATEST_KEY, 'json')).toMatchObject({
      backupId: '2026-10-24T02:00:00Z',
    });
  });

  it('can run again for the same day, writing the same keys', async () => {
    seedMembers(2);
    await backup(day1);
    const keys = async () =>
      (await BACKUPS.list({ prefix: 'firestore/2026-10-24T02:00:00Z/members/' })).keys.map(
        ({ name }) => name,
      );
    const first = await keys();

    await backup(day1);

    expect(await keys()).toEqual(first);
    expect(first).toEqual(['firestore/2026-10-24T02:00:00Z/members/0000']);
  });

  it('finishes an empty database with a manifest', async () => {
    expect(await backup()).toBe(1);

    expect(await BACKUPS.get('firestore/2026-10-24T02:00:00Z/manifest', 'json')).toMatchObject({
      documents: {},
    });
  });
});
