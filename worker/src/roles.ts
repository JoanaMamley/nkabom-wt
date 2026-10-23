import { HttpError } from './http';
import type { Role } from './model';
import type { Account } from './users';

export const ADMIN_ROLES: readonly string[] = ['admin', 'primaryAdmin'] satisfies Role[];

// Admin endpoints call this after requireAccount (FR-1.11), which has just read the role.
export function requireAdmin(account: Account): void {
  if (!ADMIN_ROLES.includes(account.role)) {
    throw new HttpError(403, 'Only admins can do this');
  }
}
