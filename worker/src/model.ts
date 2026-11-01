// Firestore data model (NKB-103). The Worker is the only writer of these collections and checks
// these shapes before writing; firestore.rules decides who can read them. The rules tests in
// tests/ use the names from here.

export const USERS = 'users';
export const MEMBERS = 'members';
export const DIRECTORY = 'directory';
export const AUDIT_LOG = 'auditLog';
export const JOB_STATUS = 'jobStatus';
export const EMAIL_VERIFICATIONS = 'emailVerifications';

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

// FR-2.3: accepted photo types with the file extension each is stored under, and the size limit.
export const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
export type PhotoType = keyof typeof PHOTO_TYPES;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * users/{uid}: one per Firebase Auth account, created by the Worker on the account's first call
 * (requireAccount in users.ts).
 */
export interface UserRecord {
  role: Role;
  email: string | null;
  createdAt: Date;
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
  /** Key in the private PHOTOS KV namespace, photos/{uid}/{uuid}.{ext} (NKB-115). Never a URL. */
  photoPath: string;
  status: MemberStatus;
  /** Registration date (FR-3.2). */
  createdAt: Date;
  /** Last updated (FR-2.5). */
  updatedAt: Date;
}

// FR-5.2: the only profile fields other members may see. Never add date of birth or contact details.
export const DIRECTORY_FIELDS = [
  'firstNames',
  'surname',
  'photoPath',
  'courseOrOccupation',
  'graduationYear',
] as const;

/**
 * directory/{uid}: the limited profile members see in the mentor directory (FR-3.1, FR-5.2). One
 * per active member, written with each change to members/{uid} (directory.ts).
 */
export type DirectoryEntry = Pick<MemberProfile, (typeof DIRECTORY_FIELDS)[number]>;

// FR-8.3: the admin actions the audit log records. Add new actions here.
export const AUDIT_ACTIONS = [
  'admin.login',
  'admin.create',
  'admin.roleChange',
  'admin.deactivate',
  'admin.delete',
  'registration.approve',
  'registration.reject',
  'member.edit',
  'member.deactivate',
  'member.delete',
  'members.export',
  'calendar.share',
  'calendar.unshare',
  'constitution.publish',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditTarget {
  type: 'member' | 'admin' | 'constitution';
  id: string;
}

/** Extra facts about an action, such as a rejection reason. Never a date of birth or a photo. */
export type AuditDetails = Record<string, string | number | boolean | null>;

/**
 * auditLog/{autoId}: one admin action (FR-8.3). Only the Worker writes entries, and nothing edits
 * or deletes them. The actor's name and email are copied in so the entry still reads correctly
 * after the admin is renamed or deleted.
 */
export interface AuditEntry {
  actor: { uid: string; name: string | null; email: string | null };
  action: AuditAction;
  /** Null for actions without one subject, such as an export. */
  target: AuditTarget | null;
  details: AuditDetails | null;
  at: Date;
}

export const JOB_OUTCOMES = ['succeeded', 'retrying', 'failed'] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

/**
 * jobStatus/{schedule}-{task}: how a scheduled task's last run went (NKB-118), kept here because
 * Worker logs last only 3 days. Only the Worker writes it.
 */
export interface JobStatus {
  schedule: string;
  task: string;
  /** retrying while attempts remain, failed once they have all failed. */
  status: JobOutcome;
  /** When the trigger fired for this run. */
  scheduledTime: Date;
  finishedAt: Date;
  /** 1 for the first try, up to MAX_ATTEMPTS in jobs.ts. */
  attempt: number;
  error: string | null;
  lastSucceededAt: Date | null;
  /** Runs in a row that failed every attempt. */
  consecutiveFailures: number;
  /** When a Primary Admin was emailed about the current failures; null once a run succeeds. */
  alertedAt: Date | null;
}

/**
 * emailVerifications/{uid}: when the account was last sent a verification email (NKB-202), to
 * limit how often it can ask. Only the Worker reads and writes it.
 */
export interface EmailVerification {
  /** Milliseconds since 1970, as Date.now() gives. */
  lastSentAt: number;
  /** The UTC day count applies to, as YYYY-MM-DD. */
  day: string;
  /** Emails sent on that day. */
  count: number;
}
