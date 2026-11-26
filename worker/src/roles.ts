import { HttpError } from './http';
import type { Role } from './model';
import type { Account } from './users';

export const ADMIN_ROLES: readonly string[] = ['admin', 'primaryAdmin'] satisfies Role[];

export function isAdmin(account: Account): boolean {
  return ADMIN_ROLES.includes(account.role);
}

// Admin endpoints call this after requireAccount (FR-1.11), which has just read the role.
export function requireAdmin(account: Account): void {
  if (!isAdmin(account)) {
    throw new HttpError(403, 'Only admins can do this');
  }
}

// Managing admin accounts needs a Primary Admin (FR-1.5, FR-1.6).
export function requirePrimaryAdmin(account: Account): void {
  if (account.role !== 'primaryAdmin') {
    throw new HttpError(403, 'Only a Primary Admin can do this');
  }
}
