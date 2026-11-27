import { HttpError } from './http';
import type { Role } from './model';
import type { Account } from './users';

export const ADMIN_ROLES: readonly string[] = ['admin', 'primaryAdmin'] satisfies Role[];

/**
 * How admins may sign in (FR-1.9): with email and password, or with Google once Google is linked
 * to their admin account (NKB-213). Firebase names them so in the token's sign_in_provider.
 */
export const ADMIN_SIGN_IN_PROVIDERS: readonly string[] = ['password', 'google.com'];

/** How recent a sign-in must be to manage admins (NKB-213). */
export const RECENT_SIGN_IN_MINUTES = 15;
/** The code with the refusal, on which the app asks the admin to confirm it is them. */
export const RECENT_SIGN_IN_REQUIRED = 'recent-sign-in-required';

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

/**
 * The most sensitive actions, such as managing admins, need a sign-in from the last
 * RECENT_SIGN_IN_MINUTES (NKB-213), so a stolen session or a device left signed in cannot make
 * them. The app then asks the admin to sign in again, with their password or Google, and tries
 * once more. Checked after the role, so a member is told they cannot, not asked to sign in.
 */
export function requireRecentSignIn(account: Account, now = Date.now()): void {
  if (now / 1000 - account.authTime > RECENT_SIGN_IN_MINUTES * 60) {
    throw new HttpError(
      403,
      'For your safety, confirm it is you before making this change.',
      RECENT_SIGN_IN_REQUIRED,
    );
  }
}
