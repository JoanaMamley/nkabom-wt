import { Environment } from './environment.model';

// Staging build (ng build --configuration production,staging). Real values are filled in once the
// nkabom-staging project exists (NKB-109). Like production, the web config is not a secret.
export const environment: Environment = {
  production: true,
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
};
