import { inject, Injectable } from '@angular/core';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type OAuthCredential,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

import type { FirebaseError } from 'firebase/app';

import { FIREBASE_AUTH } from './firebase';

/** A Google sign-in waiting to be added to the email and password account with its address. */
export interface GoogleLink {
  email: string;
  /** Whether Google says the address is verified. Only a verified one is linked (FR-1.3). */
  emailVerified: boolean;
  credential: OAuthCredential;
}

/** The Firebase Auth calls pages make, in one place so their tests can replace them. */
@Injectable({ providedIn: 'root' })
export class Accounts {
  private readonly auth = inject(FIREBASE_AUTH);

  /** The signed-in user, once Firebase has restored any saved sign-in, or null. */
  async currentUser(): Promise<User | null> {
    await this.auth.authStateReady();
    return this.auth.currentUser;
  }

  /** Creates an email and password account and signs in to it. */
  async signUp(email: string, password: string): Promise<User> {
    return (await createUserWithEmailAndPassword(this.auth, email, password)).user;
  }

  /**
   * Logs in with email and password. With remember, the sign-in survives closing the browser on
   * this device; without it, it ends when the browser or tab closes.
   */
  async logIn(email: string, password: string, remember: boolean): Promise<User> {
    await setPersistence(this.auth, remember ? browserLocalPersistence : browserSessionPersistence);
    return (await signInWithEmailAndPassword(this.auth, email, password)).user;
  }

  /**
   * Logs in with Google (FR-1.1, NKB-210), creating the account on a first login. Google accounts
   * have verified addresses, so no verification email is needed. Uses a pop-up, except in an
   * app installed on an iPhone's Home Screen, where the pop-up cannot hand the sign-in back: there
   * the page goes to Google and comes back, and this resolves to null as it leaves. The page it
   * comes back to finishes with googleRedirectResult(). remember is as for logIn; leaving it out
   * keeps the sign-in after the browser closes, as sign-up does.
   */
  async logInWithGoogle(remember = true): Promise<User | null> {
    await setPersistence(this.auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const provider = new GoogleAuthProvider();
    // On a shared device, let each member pick their own Google account.
    provider.setCustomParameters({ prompt: 'select_account' });
    if (installedOnIPhone()) {
      sessionStorage.setItem(GOOGLE_REDIRECT_KEY, '1');
      await signInWithRedirect(this.auth, provider);
      return null;
    }
    return (await signInWithPopup(this.auth, provider)).user;
  }

  /**
   * The user from a Google login that went to Google and came back (logInWithGoogle), or null if
   * this page load is not one. Checks for one only when this tab started it, since asking Firebase
   * otherwise costs a network round trip on every visit to the page.
   */
  async googleRedirectResult(): Promise<User | null> {
    if (!sessionStorage.getItem(GOOGLE_REDIRECT_KEY)) {
      return null;
    }
    sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
    return (await getRedirectResult(this.auth))?.user ?? null;
  }

  /**
   * The Google sign-in Firebase refused with auth/account-exists-with-different-credential, because
   * an email and password account already uses the address (NKB-213), or null if the error is
   * not that or lacks what linking needs. emailVerified is what Google's ID token says.
   */
  pendingGoogleLink(error: unknown): GoogleLink | null {
    if (
      (error as { code?: string } | null)?.code !== 'auth/account-exists-with-different-credential'
    ) {
      return null;
    }
    const credential = GoogleAuthProvider.credentialFromError(error as FirebaseError);
    const email = (error as FirebaseError).customData?.['email'];
    if (!credential || typeof email !== 'string') {
      return null;
    }
    return { email, emailVerified: googleEmailVerified(credential.idToken), credential };
  }

  /** Adds the Google sign-in to the account (NKB-213), so the member can use either. */
  async linkGoogle(user: User, credential: OAuthCredential): Promise<void> {
    await linkWithCredential(user, credential);
  }

  /** How the signed-in user can sign in: 'password', 'google.com' or both (NKB-213). */
  signInMethods(): string[] {
    return this.auth.currentUser?.providerData.map((provider) => provider.providerId) ?? [];
  }

  /**
   * Signs the current user in again with their password, so the Worker sees a recent sign-in
   * (NKB-213), and takes a new ID token that says so.
   */
  async confirmWithPassword(password: string): Promise<void> {
    const user = this.requireUser();
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, password));
    await user.getIdToken(true);
  }

  /**
   * The same with Google, in a pop-up. Firebase refuses a Google account other than the one
   * linked to this user (auth/user-mismatch).
   */
  async confirmWithGoogle(): Promise<void> {
    const user = this.requireUser();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account', login_hint: user.email ?? '' });
    await reauthenticateWithPopup(user, provider);
    await user.getIdToken(true);
  }

  private requireUser(): User {
    const user = this.auth.currentUser;
    if (!user) {
      throw Object.assign(new Error('Not signed in'), { code: 'auth/no-current-user' });
    }
    return user;
  }

  signOut(): Promise<void> {
    return signOut(this.auth);
  }
}

/** The email_verified claim of a Google ID token, false if it is missing or unreadable. */
export function googleEmailVerified(idToken: string | undefined): boolean {
  try {
    const payload = idToken?.split('.')[1];
    if (!payload) {
      return false;
    }
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { email_verified?: unknown }).email_verified === true;
  } catch {
    return false;
  }
}

/** Set in sessionStorage while a Google login has gone to Google and not yet come back. */
const GOOGLE_REDIRECT_KEY = 'nkabom.googleRedirect';

/** Whether the app runs from an iPhone's (or iPad's) Home Screen, which only Safari reports. */
export function installedOnIPhone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Reloads the user, to see an email address verified meanwhile (possibly on another device), and
 * then takes a new ID token, so the Worker and the rules see it too.
 */
export async function refreshSignIn(user: User): Promise<void> {
  await user.reload();
  if (user.emailVerified) {
    await user.getIdToken(true);
  }
}
