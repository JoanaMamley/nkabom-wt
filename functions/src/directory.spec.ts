import { beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory Firestore holding just enough for one transaction: getAll, set and delete.
const { docs, writes } = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as string[],
}));

vi.mock('firebase-admin/firestore', () => {
  const ref = (path: string) => ({ path });
  return {
    getFirestore: () => ({
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: (update: (tx: unknown) => Promise<void>) =>
        update({
          getAll: (...refs: { path: string }[]) =>
            refs.map(({ path }) => ({ exists: docs.has(path), data: () => docs.get(path) })),
          set: ({ path }: { path: string }, data: Record<string, unknown>) => {
            writes.push(`set ${path}`);
            docs.set(path, data);
          },
          delete: ({ path }: { path: string }) => {
            writes.push(`delete ${path}`);
            docs.delete(path);
          },
        }),
    }),
  };
});

import { directoryEntry, syncDirectory, syncDirectoryEntry } from './directory';
import type { MemberProfile } from './model';

const profile = {
  firstNames: 'Ama Serwaa',
  surname: 'Mensah',
  dateOfBirth: '1998-02-28',
  stage: 'graduate',
  courseOrOccupation: 'Civil engineer',
  graduationYear: 2020,
  photoPath: 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp',
  status: 'active',
  createdAt: 'CREATED',
  updatedAt: 'UPDATED',
} as unknown as MemberProfile;

const entry = {
  firstNames: 'Ama Serwaa',
  surname: 'Mensah',
  photoPath: 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp',
  courseOrOccupation: 'Civil engineer',
  graduationYear: 2020,
};

beforeEach(() => {
  docs.clear();
  writes.length = 0;
});

describe('directoryEntry', () => {
  it('keeps only the directory fields of an active member', () => {
    expect(directoryEntry(profile)).toEqual(entry);
  });

  it('never includes the date of birth, stage, status or times', () => {
    expect(directoryEntry(profile)).not.toHaveProperty('dateOfBirth');
    expect(directoryEntry(profile)).not.toHaveProperty('stage');
    expect(directoryEntry(profile)).not.toHaveProperty('status');
    expect(directoryEntry(profile)).not.toHaveProperty('updatedAt');
  });

  it.each(['pending', 'rejected', 'deactivated'])('leaves out a %s member', (status) => {
    expect(directoryEntry({ ...profile, status } as MemberProfile)).toBeNull();
  });

  it('leaves out a deleted profile', () => {
    expect(directoryEntry(undefined)).toBeNull();
  });
});

describe('syncDirectory', () => {
  it('lists a member once they are active', async () => {
    docs.set('members/ama', { ...profile });

    await syncDirectory('ama');

    expect(docs.get('directory/ama')).toEqual(entry);
  });

  it('does not list a pending member', async () => {
    docs.set('members/ama', { ...profile, status: 'pending' });

    await syncDirectory('ama');

    expect(writes).toEqual([]);
  });

  it('updates the entry when a listed field changes', async () => {
    docs.set('members/ama', { ...profile, courseOrOccupation: 'Site manager' });
    docs.set('directory/ama', { ...entry });

    await syncDirectory('ama');

    expect(docs.get('directory/ama')).toEqual({ ...entry, courseOrOccupation: 'Site manager' });
  });

  it('writes nothing when only unlisted fields change', async () => {
    docs.set('members/ama', { ...profile, dateOfBirth: '1998-03-01', updatedAt: 'LATER' });
    docs.set('directory/ama', { ...entry });

    await syncDirectory('ama');

    expect(writes).toEqual([]);
  });

  it.each(['rejected', 'deactivated'])('removes a member who becomes %s', async (status) => {
    docs.set('members/ama', { ...profile, status });
    docs.set('directory/ama', { ...entry });

    await syncDirectory('ama');

    expect(docs.has('directory/ama')).toBe(false);
  });

  it('removes a member whose profile is deleted', async () => {
    docs.set('directory/ama', { ...entry });

    await syncDirectory('ama');

    expect(docs.has('directory/ama')).toBe(false);
  });

  it('replaces an entry holding a field it should not have', async () => {
    docs.set('members/ama', { ...profile });
    docs.set('directory/ama', { ...entry, dateOfBirth: '1998-02-28' });

    await syncDirectory('ama');

    expect(docs.get('directory/ama')).toEqual(entry);
  });
});

describe('syncDirectoryEntry', () => {
  it('syncs the member whose profile was written, as it is now', async () => {
    docs.set('members/ama', { ...profile });

    await syncDirectoryEntry.run({ params: { uid: 'ama' } } as unknown as Parameters<
      typeof syncDirectoryEntry.run
    >[0]);

    expect(docs.get('directory/ama')).toEqual(entry);
  });

  it('is retried when it fails', () => {
    expect(syncDirectoryEntry.__endpoint.eventTrigger).toMatchObject({ retry: true });
  });
});
