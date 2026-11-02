import { inject, Injectable } from '@angular/core';
import { createUserWithEmailAndPassword, signOut, type User } from 'firebase/auth';

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

  signOut(): Promise<void> {
    return signOut(this.auth);
  }
}
