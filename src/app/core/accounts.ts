import { inject, Injectable } from '@angular/core';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';

import { FIREBASE_AUTH } from './firebase';

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

  signOut(): Promise<void> {
    return signOut(this.auth);
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
