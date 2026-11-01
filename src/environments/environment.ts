import { Environment } from './environment.model';

// Production build. Real values are filled in once the nkabom-prod project exists (NKB-109).
// Firebase web config identifies the project; it is not a secret, but keep server keys out of here.
export const environment: Environment = {
  production: true,
  apiUrl: 'https://nkabom-api-prod.nkabomwt-project.workers.dev',
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
};
