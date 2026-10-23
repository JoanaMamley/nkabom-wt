import { describe, expect, it } from 'vitest';

import { directoryEntry, syncDirectory } from './directory';
import { WriteBatch } from './firestore';
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
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
} as MemberProfile;

const entry = {
  firstNames: 'Ama Serwaa',
  surname: 'Mensah',
  photoPath: 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp',
  courseOrOccupation: 'Civil engineer',
  graduationYear: 2020,
};

// The writes syncDirectory adds for ama's profile and current entry.
function sync(current: MemberProfile | null, listed: Record<string, unknown> | null) {
  const batch = new WriteBatch();
  syncDirectory(batch, 'ama', current, listed);
  return batch.writes;
}

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
    expect(directoryEntry(null)).toBeNull();
  });
});

describe('syncDirectory', () => {
  it('lists a member once they are active', () => {
    expect(sync(profile, null)).toEqual([{ op: 'set', path: 'directory/ama', data: entry }]);
  });

  it('does not list a pending member', () => {
    expect(sync({ ...profile, status: 'pending' }, null)).toEqual([]);
  });

  it('updates the entry when a listed field changes', () => {
    expect(sync({ ...profile, courseOrOccupation: 'Site manager' }, entry)).toEqual([
      { op: 'set', path: 'directory/ama', data: { ...entry, courseOrOccupation: 'Site manager' } },
    ]);
  });

  it('writes nothing when only unlisted fields change', () => {
    expect(sync({ ...profile, dateOfBirth: '1998-03-01', updatedAt: new Date() }, entry)).toEqual(
      [],
    );
  });

  it.each(['rejected', 'deactivated'])('removes a member who becomes %s', (status) => {
    expect(sync({ ...profile, status } as MemberProfile, entry)).toEqual([
      { op: 'delete', path: 'directory/ama' },
    ]);
  });

  it('removes a member whose profile is deleted', () => {
    expect(sync(null, entry)).toEqual([{ op: 'delete', path: 'directory/ama' }]);
  });

  it('replaces an entry holding a field it should not have', () => {
    expect(sync(profile, { ...entry, dateOfBirth: '1998-02-28' })).toEqual([
      { op: 'set', path: 'directory/ama', data: entry },
    ]);
  });
});
