import { TestBed } from '@angular/core/testing';

import { Accounts, googleEmailVerified } from './accounts';
import { FIREBASE_AUTH } from './firebase';

// A Google ID token with these claims. Only the payload is read, so the signature is a stand-in.
function idToken(claims: Record<string, unknown>): string {
  const part = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

describe('googleEmailVerified', () => {
  it("reads the token's email_verified claim", () => {
    expect(googleEmailVerified(idToken({ email_verified: true }))).toBe(true);
    expect(googleEmailVerified(idToken({ email_verified: false }))).toBe(false);
    expect(googleEmailVerified(idToken({}))).toBe(false);
  });

  it('is false for a missing or unreadable token', () => {
    expect(googleEmailVerified(undefined)).toBe(false);
    expect(googleEmailVerified('not a token')).toBe(false);
    expect(googleEmailVerified('a.!!!.b')).toBe(false);
  });
});

// NKB-213. Firebase's error carries the Google sign-in in customData._tokenResponse.
describe('Accounts.pendingGoogleLink', () => {
  let accounts: Accounts;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: FIREBASE_AUTH, useValue: {} }] });
    accounts = TestBed.inject(Accounts);
  });

  function exists(emailVerified: boolean, email: unknown = 'ama@example.com') {
    return {
      code: 'auth/account-exists-with-different-credential',
      customData: {
        email,
        _tokenResponse: {
          providerId: 'google.com',
          oauthIdToken: idToken({ email: 'ama@example.com', email_verified: emailVerified }),
          oauthAccessToken: 'access',
        },
      },
    };
  }

  it('keeps the Google sign-in and whether Google verified the address', () => {
    const link = accounts.pendingGoogleLink(exists(true));
    expect(link?.email).toBe('ama@example.com');
    expect(link?.emailVerified).toBe(true);
    expect(link?.credential.providerId).toBe('google.com');

    expect(accounts.pendingGoogleLink(exists(false))?.emailVerified).toBe(false);
  });

  it('is null for any other error, or one without an address', () => {
    expect(accounts.pendingGoogleLink({ code: 'auth/popup-blocked' })).toBeNull();
    expect(accounts.pendingGoogleLink(null)).toBeNull();
    expect(accounts.pendingGoogleLink(exists(true, null))).toBeNull();
  });
});
