import type { Timestamp } from 'firebase-admin/firestore';

// Firestore data model (NKB-103). firestore.rules validates the same shapes, so change both
// together; the rules tests in tests/ check that they agree.

export const USERS = 'users';
export const MEMBERS = 'members';

// FR-1.5: a Primary Admin is an admin who can also manage admin accounts.
export const ROLES = ['member', 'admin', 'primaryAdmin'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['pending', 'active', 'rejected', 'deactivated'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

// FR-2.1 "Status: Student or Graduate/Working", named stage so it is not confused with status.
export const STAGES = ['student', 'graduate'] as const;
export type Stage = (typeof STAGES)[number];

// FR-2.2: graduation year from 1990 to the current year + 8.
export const MIN_GRADUATION_YEAR = 1990;
export const MAX_YEARS_TO_GRADUATION = 8;

/** users/{uid}: one per Firebase Auth account. Only Cloud Functions write it. */
export interface UserRecord {
  role: Role;
  email: string | null;
  createdAt: Timestamp;
}

/**
 * members/{uid}: a member's profile (FR-2.1). Using the user ID as the document ID means a user
 * can have only one profile (FR-2.6).
 */
export interface MemberProfile {
  firstNames: string;
  surname: string;
  /** YYYY-MM-DD. A calendar date, not a Timestamp, so no time zone can shift the birthday. */
  dateOfBirth: string;
  stage: Stage;
  /** Course of study for a student, occupation for a graduate. */
  courseOrOccupation: string;
  graduationYear: number;
  /** Object key in the private R2 bucket (NKB-105), never a URL. */
  photoPath: string;
  status: MemberStatus;
  /** Registration date (FR-3.2). */
  createdAt: Timestamp;
  /** Last updated (FR-2.5). */
  updatedAt: Timestamp;
}
