import type { Env } from './env';
import {
  listCollections,
  listDocumentsAfter,
  listDocumentsPage,
  type RawDocument,
} from './firestore';
import { continueTask, type JobRun, type Task, type TaskResult } from './tasks';
import { AUDIT_LOG } from './model';

// Daily Firestore backup to the private BACKUPS Workers KV namespace (FR-8.6, NKB-119). Each
// collection is read a page at a time, one page per queued step, so each invocation stays within
// the free plan's CPU and subrequest limits. In KV:
//
//   firestore/{backupId}/{collection}/{page}  a page of documents, kept 30 days
//   firestore/{backupId}/manifest             written last, so a backup without one is incomplete
//   auditLog/{backupId}/{page}                audit entries new since the last backup, kept for good
//   firestore/latest                          the last complete backup and how far the audit log got
//
// The audit log only grows, so each backup holds just its new entries; a restore loads every
// increment up to the backup it restores. backupId is the trigger time, such as
// 2026-10-24T02:00:00Z, so keys sort by time. scripts/restore-backup.mjs reads them back.

/** Documents per page, and so per KV value: well under KV's 25 MB, and quick to read and write. */
export const PAGE_SIZE = 100;
export const BACKUP_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LATEST_KEY = 'firestore/latest';

/** The last audit entry backed up: its time, exactly as Firestore gave it, and its path. */
export interface AuditCursor {
  time: string;
  path: string;
}

export interface LatestBackup {
  backupId: string;
  auditCursor: AuditCursor | null;
}

export interface BackupManifest {
  backupId: string;
  finishedAt: string;
  /** Documents per collection, the audit log's new entries included. */
  documents: Record<string, number>;
  /** The audit entries this backup added: those after `after`, up to and including `through`. */
  auditLog: { after: AuditCursor | null; through: AuditCursor | null };
}

/** Where a backup has got to, passed from one step to the next. */
interface BackupStep {
  backupId: string;
  collections: string[];
  index: number;
  page: number;
  pageToken?: string;
  documents: Record<string, number>;
  auditAfter: AuditCursor | null;
  auditCursor: AuditCursor | null;
}

export const backupTask: Task = {
  name: 'backupFirestore',
  async run(env, run) {
    // Every collection, so new ones are backed up without a change here.
    const latest = await env.BACKUPS.get<LatestBackup>(LATEST_KEY, 'json');
    const auditCursor = latest?.auditCursor ?? null;
    return backupPage(env, run, {
      backupId: new Date(run.scheduledTime).toISOString().replace(/\.\d+Z$/, 'Z'),
      collections: await listCollections(env),
      index: 0,
      page: 0,
      documents: {},
      auditAfter: auditCursor,
      auditCursor,
    });
  },
  step: (env, run, step) => backupPage(env, run, step as BackupStep),
};

// Backs up one page of the current collection, then queues the next page or collection, or
// finishes. A retried step writes the same keys again, so it is safe to repeat.
async function backupPage(env: Env, run: JobRun, step: BackupStep): Promise<TaskResult> {
  const collection = step.collections[step.index];
  if (collection === undefined) {
    return finish(env, step);
  }
  const page = String(step.page).padStart(4, '0');

  let documents: RawDocument[];
  let more: boolean;
  let { pageToken, auditCursor } = step;
  if (collection === AUDIT_LOG) {
    documents = await listDocumentsAfter(env, AUDIT_LOG, 'at', auditCursor, PAGE_SIZE);
    if (documents.length > 0) {
      await putPage(env, `${AUDIT_LOG}/${step.backupId}/${page}`, documents, false);
      auditCursor = cursorOf(documents.at(-1)!);
    }
    more = documents.length === PAGE_SIZE;
  } else {
    ({ documents, nextPageToken: pageToken } = await listDocumentsPage(
      env,
      collection,
      PAGE_SIZE,
      pageToken,
    ));
    if (documents.length > 0) {
      await putPage(env, `firestore/${step.backupId}/${collection}/${page}`, documents, true);
    }
    more = pageToken !== undefined;
  }

  const next: BackupStep = {
    ...step,
    documents: {
      ...step.documents,
      [collection]: (step.documents[collection] ?? 0) + documents.length,
    },
    auditCursor,
    ...(more
      ? { page: step.page + 1, pageToken }
      : { index: step.index + 1, page: 0, pageToken: undefined }),
  };
  return next.index < next.collections.length ? continueTask(env, run, next) : finish(env, next);
}

async function putPage(env: Env, key: string, documents: RawDocument[], expires: boolean) {
  await env.BACKUPS.put(
    key,
    JSON.stringify(documents),
    expires ? { expirationTtl: BACKUP_TTL_SECONDS } : {},
  );
}

function cursorOf(document: RawDocument): AuditCursor {
  const at = document.fields['at'];
  if (!at || !('timestampValue' in at)) {
    throw new Error(`Audit entry ${document.path} has no time`);
  }
  return { time: at.timestampValue, path: document.path };
}

async function finish(env: Env, step: BackupStep): Promise<void> {
  const manifest: BackupManifest = {
    backupId: step.backupId,
    finishedAt: new Date().toISOString(),
    documents: step.documents,
    auditLog: { after: step.auditAfter, through: step.auditCursor },
  };
  await env.BACKUPS.put(`firestore/${step.backupId}/manifest`, JSON.stringify(manifest), {
    expirationTtl: BACKUP_TTL_SECONDS,
  });
  // Last, so the next backup's audit increment starts from a backup that finished.
  const latest: LatestBackup = { backupId: step.backupId, auditCursor: step.auditCursor };
  await env.BACKUPS.put(LATEST_KEY, JSON.stringify(latest));
  console.log('Firestore backup finished', { backupId: step.backupId, documents: step.documents });
}
