import type { Fields, WriteBatch } from './firestore';
import { DIRECTORY, DIRECTORY_FIELDS, type DirectoryEntry, type MemberProfile } from './model';

/**
 * The directory entry for a profile: only the FR-5.2 fields, and only for an active member. Null
 * means the member must not be in the directory (no profile, or pending, rejected or deactivated).
 */
export function directoryEntry(profile: MemberProfile | null): DirectoryEntry | null {
  if (profile?.status !== 'active') {
    return null;
  }
  return Object.fromEntries(
    DIRECTORY_FIELDS.map((field) => [field, profile[field]]),
  ) as unknown as DirectoryEntry;
}

// Same fields and values. An entry holding any other field, such as one added by hand, differs,
// so the sync replaces it.
function sameEntry(a: DirectoryEntry, b: Fields | null): boolean {
  return (
    b !== null &&
    Object.keys(b).length === DIRECTORY_FIELDS.length &&
    DIRECTORY_FIELDS.every((field) => a[field] === b[field])
  );
}

/**
 * Keeps directory/{uid} in step with a member's profile (NKB-111): lists the member once they are
 * active, copies changes to the listed fields, and removes the entry otherwise. Call it in the
 * transaction that writes the profile, with the profile as that write leaves it (null if deleted)
 * and the entry as read in the same transaction, so the two can never disagree.
 */
export function syncDirectory(
  tx: WriteBatch,
  uid: string,
  profile: MemberProfile | null,
  listed: Fields | null,
): void {
  const path = `${DIRECTORY}/${uid}`;
  const entry = directoryEntry(profile);
  if (!entry) {
    if (listed) {
      tx.delete(path);
    }
  } else if (!sameEntry(entry, listed)) {
    // set, not update, so the entry never keeps a field the profile no longer has.
    tx.set(path, entry);
  }
}
