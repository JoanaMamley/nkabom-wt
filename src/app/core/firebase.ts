import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';

import { environment } from '../../environments/environment';
import type { Firestore } from './firestore';

export type FirestoreLoader = () => Promise<Firestore>;

export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');
export const FIRESTORE_LOADER = new InjectionToken<FirestoreLoader>('FIRESTORE_LOADER');

// The Firestore SDK is over half the initial bundle and the logged-out pages never use it, so it
// loads on first use. Callers that need doc, getDoc and the rest import them from './firestore'
// with a dynamic import(); that resolves to the same lazy chunk.
function lazyFirestore(app: FirebaseApp): FirestoreLoader {
  let firestore: Promise<Firestore> | undefined;

  return () =>
    (firestore ??= import('./firestore')
      .then(({ initFirestore }) => initFirestore(app))
      .catch((error: unknown) => {
        firestore = undefined; // allow a retry after a failed chunk load, e.g. a dropped connection
        throw error;
      }));
}

export function provideFirebase(): EnvironmentProviders {
  const app = initializeApp(environment.firebase);
  const auth = getAuth(app);

  if (environment.emulators) {
    connectAuthEmulator(auth, environment.emulators.authUrl, { disableWarnings: true });
  }

  return makeEnvironmentProviders([
    { provide: FIREBASE_APP, useValue: app },
    { provide: FIREBASE_AUTH, useValue: auth },
    { provide: FIRESTORE_LOADER, useValue: lazyFirestore(app) },
  ]);
}
