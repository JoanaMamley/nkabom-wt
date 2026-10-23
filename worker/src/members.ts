import { syncDirectory } from './directory';
import type { Env } from './env';
import { type Fields, runTransaction, SERVER_TIME, type Transaction } from './firestore';
import { HttpError, json, readJson } from './http';
import {
  DIRECTORY,
  MAX_YEARS_TO_GRADUATION,
  MEMBERS,
  type MemberProfile,
  type MemberStatus,
  MIN_GRADUATION_YEAR,
  STAGES,
} from './model';
import { photoExists, photoOwner } from './photos';
import type { Account } from './users';

// Member profiles (FR-2.1). Members write their profile only through these endpoints, never
// directly: the rules deny every client write to members/{uid}, so these checks cannot be skipped.

/** The fields a member fills in. The rest (status and times) are set here. */
export const DETAIL_FIELDS = [
  'firstNames',
  'surname',
  'dateOfBirth',
  'stage',
  'courseOrOccupation',
  'graduationYear',
  'photoPath',
] as const;
export type MemberDetails = Pick<MemberProfile, (typeof DETAIL_FIELDS)[number]>;

// FR-2.4: pending and active members can edit their details. A rejected or deactivated member's
// record is for the admins to change.
const EDITABLE_STATUSES: MemberStatus[] = ['pending', 'active'];

/**
 * POST /v1/registration with every detail field: creates the caller's profile as pending
 * (FR-2.9). A user can register only once (FR-2.6).
 */
export async function register(request: Request, env: Env, account: Account): Promise<Response> {
  const details = await checkDetails(env, account.uid, await readJson(request), true);

  await runTransaction(env, async (tx) => {
    const { profile, listed } = await readMember(tx, account.uid);
    if (profile) {
      throw new HttpError(409, 'You have already registered');
    }
    const created = { ...details, status: 'pending', createdAt: SERVER_TIME };
    tx.create(`${MEMBERS}/${account.uid}`, { ...created, updatedAt: SERVER_TIME });
    // A pending member is not listed, so this only removes an entry left over from before.
    syncDirectory(tx, account.uid, created as unknown as MemberProfile, listed);
  });

  return json({ status: 'pending' }, 201);
}

/**
 * PATCH /v1/profile with any of the detail fields: changes the caller's own details (FR-2.4). An
 * empty body changes nothing but still sets the last-updated time, so members can confirm their
 * details are still right (FR-2.5).
 */
export async function editProfile(request: Request, env: Env, account: Account): Promise<Response> {
  const changes = await checkDetails(env, account.uid, await readJson(request), false);

  await runTransaction(env, async (tx) => {
    const { profile, listed } = await readMember(tx, account.uid);
    if (!profile) {
      throw new HttpError(404, 'Register first');
    }
    if (!EDITABLE_STATUSES.includes(profile.status)) {
      throw new HttpError(403, 'Your profile cannot be changed');
    }
    changeProfile(tx, account.uid, profile, listed, changes);
  });

  return new Response(null, { status: 204 });
}

/** A member's profile and directory entry, read in a transaction before changing either. */
export async function readMember(
  tx: Transaction,
  uid: string,
): Promise<{ profile: MemberProfile | null; listed: Fields | null }> {
  const [profile, listed] = await tx.getAll(`${MEMBERS}/${uid}`, `${DIRECTORY}/${uid}`);
  return { profile: profile as MemberProfile | null, listed };
}

/**
 * Changes fields of an existing profile, sets its last-updated time, and updates the directory to
 * match, all in the one transaction. Status changes (approval NKB-307, deactivation) use this too.
 */
export function changeProfile(
  tx: Transaction,
  uid: string,
  profile: MemberProfile,
  listed: Fields | null,
  changes: Partial<MemberProfile>,
): void {
  tx.update(`${MEMBERS}/${uid}`, { ...changes, updatedAt: SERVER_TIME });
  syncDirectory(tx, uid, { ...profile, ...changes }, listed);
}

/**
 * The detail fields from a request body, checked and with text trimmed (FR-2.2). With required,
 * every field must be there; otherwise only those given are checked. Any other field, such as
 * status, is refused.
 */
export async function checkDetails(
  env: Env,
  uid: string,
  body: Record<string, unknown>,
  required: boolean,
): Promise<Partial<MemberDetails>> {
  const unknown = Object.keys(body).find(
    (field) => !(DETAIL_FIELDS as readonly string[]).includes(field),
  );
  if (unknown) {
    throw new HttpError(400, `${unknown} cannot be set`);
  }
  if (required) {
    const missing = DETAIL_FIELDS.find((field) => !(field in body));
    if (missing) {
      throw new HttpError(400, `${missing} is required`);
    }
  }

  const details: Partial<MemberDetails> = {};
  if ('firstNames' in body) details.firstNames = text(body.firstNames, 'First names');
  if ('surname' in body) details.surname = text(body.surname, 'Surname');
  if ('dateOfBirth' in body) details.dateOfBirth = dateOfBirth(body.dateOfBirth);
  if ('stage' in body) {
    if (!STAGES.includes(body.stage as MemberProfile['stage'])) {
      throw new HttpError(400, 'Stage must be student or graduate');
    }
    details.stage = body.stage as MemberProfile['stage'];
  }
  if ('courseOrOccupation' in body) {
    details.courseOrOccupation = text(body.courseOrOccupation, 'Course or occupation');
  }
  if ('graduationYear' in body) details.graduationYear = graduationYear(body.graduationYear);
  if ('photoPath' in body) {
    // Only a photo the member has uploaded to their own folder (NKB-115).
    const path = body.photoPath;
    if (photoOwner(path) !== uid || !(await photoExists(env, path as string))) {
      throw new HttpError(400, 'Upload your photo first');
    }
    details.photoPath = path as string;
  }
  return details;
}

function text(value: unknown, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '' || trimmed.length > 100) {
    throw new HttpError(400, `${label} must be 1 to 100 characters`);
  }
  return trimmed;
}

// A real calendar date, YYYY-MM-DD, in the past. 1900 rules out a mistyped century.
function dateOfBirth(value: unknown): string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (match) {
    // Date.UTC rolls 31 April over to 1 May, so a date that comes back different was not real.
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    const today = new Date().toISOString().slice(0, 10);
    if (
      date.toISOString().slice(0, 10) === match[0] &&
      match[0] >= '1900-01-01' &&
      match[0] < today
    ) {
      return match[0];
    }
  }
  throw new HttpError(400, 'Date of birth must be a real date in the past');
}

function graduationYear(value: unknown): number {
  const last = new Date().getUTCFullYear() + MAX_YEARS_TO_GRADUATION;
  if (
    !Number.isInteger(value) ||
    (value as number) < MIN_GRADUATION_YEAR ||
    (value as number) > last
  ) {
    throw new HttpError(400, `Graduation year must be from ${MIN_GRADUATION_YEAR} to ${last}`);
  }
  return value as number;
}
