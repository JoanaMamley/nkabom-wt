import { v1 } from '@google-cloud/firestore';
import { logger } from 'firebase-functions';
import { defineString, projectID } from 'firebase-functions/params';

import { scheduledJob } from './scheduled';

// Each project's own bucket, set in functions/.env.<project ID>, for example gs://nkabom-prod-backups.
// The bucket's lifecycle rule deletes old exports (see the README).
const backupBucket = defineString('BACKUP_BUCKET');

type AdminClient = Pick<
  InstanceType<typeof v1.FirestoreAdminClient>,
  'databasePath' | 'exportDocuments'
>;

/**
 * Starts an export of the whole default database to {bucket}/firestore/{UTC time}, and returns the
 * name of the long-running operation. The export finishes in the background; follow it with
 * gcloud firestore operations describe <name>.
 */
export async function exportFirestore(
  client: AdminClient,
  projectId: string,
  bucket: string,
  now = new Date(),
): Promise<string> {
  if (!/^gs:\/\/[a-z0-9][a-z0-9._-]+$/.test(bucket)) {
    throw new Error(`BACKUP_BUCKET must look like gs://bucket-name, not "${bucket}"`);
  }

  // 2026-10-20T02-00-00Z: sorts by time and needs no escaping in a gs:// path.
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replaceAll(':', '-');
  const outputUriPrefix = `${bucket}/firestore/${stamp}`;

  const [operation] = await client.exportDocuments({
    name: client.databasePath(projectId, '(default)'),
    outputUriPrefix,
    // Empty means every collection, so new collections are backed up without a change here.
    collectionIds: [],
  });

  logger.info('Firestore export started', { operation: operation.name, outputUriPrefix });
  return operation.name ?? '';
}

/** Daily Firestore backup (FR-8.6). Restoring is a manual step, described in the README. */
export const backupFirestore = scheduledJob(
  'backupFirestore',
  { schedule: 'every day 02:00' },
  async () => {
    await exportFirestore(new v1.FirestoreAdminClient(), projectID.value(), backupBucket.value());
  },
);
