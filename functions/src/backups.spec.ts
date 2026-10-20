import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { exportDocuments } = vi.hoisted(() => ({ exportDocuments: vi.fn() }));

vi.mock('@google-cloud/firestore', () => ({
  v1: {
    FirestoreAdminClient: class {
      databasePath = (project: string, database: string) =>
        `projects/${project}/databases/${database}`;
      exportDocuments = exportDocuments;
    },
  },
}));

import { v1 } from '@google-cloud/firestore';
import { backupFirestore, exportFirestore } from './backups';

const client = new v1.FirestoreAdminClient();
const at = new Date('2026-10-20T02:00:00.123Z');

beforeEach(() => {
  exportDocuments.mockReset();
  exportDocuments.mockResolvedValue([{ name: 'projects/nkabom-prod/operations/abc' }]);
});

describe('exportFirestore', () => {
  it('exports every collection to a time-stamped folder in the bucket', async () => {
    const operation = await exportFirestore(client, 'nkabom-prod', 'gs://nkabom-prod-backups', at);

    expect(exportDocuments).toHaveBeenCalledWith({
      name: 'projects/nkabom-prod/databases/(default)',
      outputUriPrefix: 'gs://nkabom-prod-backups/firestore/2026-10-20T02-00-00Z',
      collectionIds: [],
    });
    expect(operation).toBe('projects/nkabom-prod/operations/abc');
  });

  it.each([
    ['an empty bucket', ''],
    ['a bucket without gs://', 'nkabom-prod-backups'],
    ['a trailing slash', 'gs://nkabom-prod-backups/'],
  ])('refuses %s', async (_, bucket) => {
    await expect(exportFirestore(client, 'nkabom-prod', bucket, at)).rejects.toThrow(
      /BACKUP_BUCKET/,
    );
    expect(exportDocuments).not.toHaveBeenCalled();
  });

  it('passes on a failed export, so the scheduler retries', async () => {
    exportDocuments.mockRejectedValue(new Error('PERMISSION_DENIED'));

    await expect(
      exportFirestore(client, 'nkabom-prod', 'gs://nkabom-prod-backups', at),
    ).rejects.toThrow('PERMISSION_DENIED');
  });
});

describe('backupFirestore', () => {
  // Cloud Functions sets FIREBASE_CONFIG; BACKUP_BUCKET comes from functions/.env.<project ID>.
  const env = {
    FIREBASE_CONFIG: JSON.stringify({ projectId: 'nkabom-staging' }),
    BACKUP_BUCKET: 'gs://nkabom-staging-backups',
  };

  beforeEach(() => Object.assign(process.env, env));
  afterEach(() => Object.keys(env).forEach((name) => delete process.env[name]));

  it("exports the project's database to its BACKUP_BUCKET", async () => {
    await backupFirestore.run({} as Parameters<typeof backupFirestore.run>[0]);

    expect(exportDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'projects/nkabom-staging/databases/(default)',
        outputUriPrefix: expect.stringMatching(/^gs:\/\/nkabom-staging-backups\/firestore\//),
      }),
    );
  });
});
