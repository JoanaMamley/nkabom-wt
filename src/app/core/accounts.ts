import { inject, Injectable } from '@angular/core';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
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
   * Logs in with Google (NKB-210) or Facebook (NKB-211) (FR-1.1), creating the account on a first
   * login. Google accounts have verified addresses; Facebook ones Firebase often marks unverified,
   * and the Worker counts them as verified on the first call (requireAccount), so neither gets a
   * verification email. Uses a pop-up, except in an app installed on an iPhone's Home Screen,
   * where the pop-up cannot hand the sign-in back: there the page goes to the provider and comes
   * back, and this resolves to null as it leaves. The page it comes back to finishes with
   * socialRedirectResult(). remember is as for logIn; leaving it out keeps the sign-in after the
   * browser closes, as sign-up does.
   */
  async logInWith(provider: SocialProvider, remember = true): Promise<User | null> {
    await setPersistence(this.auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const authProvider = providerFor(provider);
    if (installedOnIPhone()) {
      sessionStorage.setItem(SOCIAL_REDIRECT_KEY, provider);
      await signInWithRedirect(this.auth, authProvider);
      return null;
    }
    return (await signInWithPopup(this.auth, authProvider)).user;
  }

  /**
   * The provider of a Google or Facebook login that this tab sent to the provider (logInWith) and
   * has not yet finished, or null. Finish it with socialRedirectResult().
   */
  pendingRedirect(): SocialProvider | null {
    const provider = sessionStorage.getItem(SOCIAL_REDIRECT_KEY);
    return provider === 'google' || provider === 'facebook' ? provider : null;
  }

  /**
   * The user from a login that went to the provider and came back (logInWith), or null if this
   * page load is not one, or the member came back without logging in. Asks Firebase only when this
   * tab started one (pendingRedirect), since asking otherwise costs a network round trip on every
   * visit to the page.
   */
  async socialRedirectResult(): Promise<User | null> {
    if (!this.pendingRedirect()) {
      return null;
    }
    sessionStorage.removeItem(SOCIAL_REDIRECT_KEY);
    return (await getRedirectResult(this.auth))?.user ?? null;
  }

  signOut(): Promise<void> {
    return signOut(this.auth);
  }
}

/** The providers members can log in with besides email and password (FR-1.1). */
export type SocialProvider = 'google' | 'facebook';

function providerFor(provider: SocialProvider): GoogleAuthProvider | FacebookAuthProvider {
  if (provider === 'google') {
    const google = new GoogleAuthProvider();
    // On a shared device, let each member pick their own Google account.
    google.setCustomParameters({ prompt: 'select_account' });
    return google;
  }
  const facebook = new FacebookAuthProvider();
  // The address is how Nkabom reaches the member, so ask for it as well as the public profile.
  facebook.addScope('email');
  return facebook;
}

/**
 * Set in sessionStorage, to the provider, while a login has gone to Google or Facebook and not
 * yet come back.
 */
const SOCIAL_REDIRECT_KEY = 'nkabom.socialRedirect';

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
