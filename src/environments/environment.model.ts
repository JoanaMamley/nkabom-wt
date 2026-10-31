import { FirebaseOptions } from 'firebase/app';

export interface Environment {
  production: boolean;
  firebase: FirebaseOptions;
  /**
   * The email address the privacy notice gives for questions about personal data (FR-1.14). Kept
   * out of the repo like the web config; automated deploys write it from the PRIVACY_CONTACT
   * variable.
   */
  privacyContact?: string;
  /** Set only for local development against the Firebase Emulator Suite. */
  emulators?: {
    authUrl: string;
    firestoreHost: string;
    firestorePort: number;
  };
}
