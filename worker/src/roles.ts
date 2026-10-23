import type { User } from './auth';
import type { Env } from './env';
import { getDocument } from './firestore';
import { HttpError } from './http';

export const ADMIN_ROLES = ['admin', 'primaryAdmin'];

// Admin endpoints call this after requireUser (FR-1.11). The role is read from users/{uid} on
// every call, so a removed admin loses access at once.
export async function requireAdmin(env: Env, user: User): Promise<void> {
  const record = await getDocument(env, `users/${user.uid}`);
  if (!ADMIN_ROLES.includes(String(record?.['role']))) {
    throw new HttpError(403, 'Only admins can do this');
  }
}
