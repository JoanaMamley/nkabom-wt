// Messages several pages show, in one place so their wording stays the same everywhere.

export const UNREACHABLE = 'Nkabom could not be reached. Check your connection and try again.';
export const SOMETHING_WENT_WRONG = 'Something went wrong. Please try again.';

/** The shortest password allowed, on sign-up and password reset. Firebase's own minimum is 6. */
export const MIN_PASSWORD_LENGTH = 8;

// Firebase Auth error codes any login or sign-up can meet, in words a member can act on.
const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/network-request-failed': UNREACHABLE,
  'auth/too-many-requests': 'Too many attempts from this device. Please try again later.',
};

/** What to tell the member about a Firebase Auth error: the page's own words first, then these. */
export function authErrorMessage(error: unknown, pageErrors: Record<string, string>): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  return pageErrors[code] ?? AUTH_ERRORS[code] ?? SOMETHING_WENT_WRONG;
}
