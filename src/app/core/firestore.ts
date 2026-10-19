import { FirebaseApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

import { environment } from '../../environments/environment';

// Lazy chunk: reach this file only through import() (see firebase.ts). It is the one file that
// imports 'firebase/firestore', and the chunk holds only what is imported here. A dynamic
// import() of the SDK itself would bundle every export (about 260 kB more), so as stories need
// doc, getDoc, query and the like, add them to the import and re-export them from this file.
export type { Firestore };

export function initFirestore(app: FirebaseApp): Firestore {
  const firestore = getFirestore(app);

  if (environment.emulators) {
    const { firestoreHost, firestorePort } = environment.emulators;
    connectFirestoreEmulator(firestore, firestoreHost, firestorePort);
  }

  return firestore;
}
