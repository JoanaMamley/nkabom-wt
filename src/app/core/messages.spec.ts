import { authErrorMessage } from './messages';

describe('authErrorMessage', () => {
  const PAGE_ERRORS = { 'auth/weak-password': 'Choose a longer password.' };

  it('uses the page’s own words first, then the shared ones', () => {
    expect(authErrorMessage({ code: 'auth/weak-password' }, PAGE_ERRORS)).toBe(
      'Choose a longer password.',
    );
    expect(authErrorMessage({ code: 'auth/network-request-failed' }, PAGE_ERRORS)).toBe(
      'Nkabom could not be reached. Check your connection and try again.',
    );
  });

  it('falls back to a general message for anything else', () => {
    for (const error of [{ code: 'auth/unknown' }, new Error('boom'), null, undefined]) {
      expect(authErrorMessage(error, PAGE_ERRORS)).toBe('Something went wrong. Please try again.');
    }
  });
});
