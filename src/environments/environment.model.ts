import { FirebaseOptions } from 'firebase/app';

export interface Environment {
  production: boolean;
  firebase: FirebaseOptions;
  /** Set only for local development against the Firebase Emulator Suite. */
  emulators?: {
    authUrl: string;
    firestoreHost: string;
    firestorePort: number;
  };
}
