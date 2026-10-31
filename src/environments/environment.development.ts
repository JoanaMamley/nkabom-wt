import { Environment } from './environment.model';

// Local development against the Firebase Emulator Suite.
// The "demo-" project ID tells Firebase there is no real project, so no credentials are needed.
export const environment: Environment = {
  production: false,
  privacyContact: 'privacy@example.com',
  emulators: {
    authUrl: 'http://127.0.0.1:9099',
    firestoreHost: '127.0.0.1',
    firestorePort: 8080,
  },
  firebase: {
    apiKey: 'demo-api-key',
    authDomain: 'demo-nkabom.firebaseapp.com',
    projectId: 'demo-nkabom',
    storageBucket: '',
    messagingSenderId: '',
    appId: 'demo-app-id',
  },
};
