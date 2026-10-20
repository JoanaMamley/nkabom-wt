import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
  DIRECTORY,
  DIRECTORY_FIELDS,
  type DirectoryEntry,
  MEMBERS,
  type MemberProfile,
} from './model';

/**
 * The directory entry for a profile: only the FR-5.2 fields, and only for an active member. Null
 * means the member must not be in the directory (no profile, or pending, rejected or deactivated).
 */
export function directoryEntry(profile: MemberProfile | undefined): DirectoryEntry | null {
  if (profile?.status !== 'active') {
    return null;
  }
  return Object.fromEntries(
    DIRECTORY_FIELDS.map((field) => [field, profile[field]]),
  ) as unknown as DirectoryEntry;
}

// Same fields and values. An entry holding any other field, such as one added by hand, differs,
// so the sync replaces it.
function sameEntry(a: DirectoryEntry, b: DirectoryEntry | undefined): boolean {
  return (
    b !== undefined &&
    Object.keys(b).length === DIRECTORY_FIELDS.length &&
    DIRECTORY_FIELDS.every((field) => a[field] === b[field])
  );
}

/**
 * Copies a member's limited profile to directory/{uid}, or removes it. It reads the profile again
 * rather than trusting the event, so events that arrive late, twice or out of order still leave
 * the entry matching the profile as it is now.
 */
export async function syncDirectory(uid: string): Promise<void> {
  const db = getFirestore();
  const member = db.collection(MEMBERS).doc(uid);
  const listed = db.collection(DIRECTORY).doc(uid);

  await db.runTransaction(async (tx) => {
    const [profile, current] = await tx.getAll(member, listed);
    const entry = directoryEntry(profile.data() as MemberProfile | undefined);

    if (!entry) {
      if (current.exists) {
        tx.delete(listed);
      }
    } else if (!sameEntry(entry, current.data() as DirectoryEntry | undefined)) {
      // set, not merge, so the entry never keeps a field the profile no longer has.
      tx.set(listed, entry);
    }
  });
}

/** Keeps the mentor directory in step with member profiles (NKB-111). */
export const syncDirectoryEntry = onDocumentWritten(
  { document: `${MEMBERS}/{uid}`, retry: true },
  (event) => syncDirectory(event.params.uid),
);
