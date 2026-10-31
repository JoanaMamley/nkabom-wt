import type { JobMessage } from './tasks';

// Bindings from wrangler.jsonc, and the secrets set with wrangler secret put.
export interface Env {
  FIREBASE_PROJECT_ID: string;
  /** Comma-separated origins the app is served from, allowed by CORS. */
  ALLOWED_ORIGINS: string;
  /** Set only for local development, as host:port. */
  FIRESTORE_EMULATOR_HOST?: string;
  /** Set only for local development, as host:port. */
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  /** Secret: the Firebase service account key, as the JSON file Firebase gives. */
  GOOGLE_SERVICE_ACCOUNT?: string;
  /** Secret: signs photo links (NKB-115). */
  PHOTO_LINK_KEY?: string;
  /** The app's address, for links in emails. */
  APP_URL: string;
  /** "gmail" (the default), "brevo", or "log" to write emails to the log instead. */
  EMAIL_PROVIDER?: string;
  /** Sender name (default Nkabom). */
  EMAIL_FROM_NAME?: string;
  /** Sender address, for Brevo and the log only; Gmail sends from GMAIL_USER. */
  EMAIL_FROM?: string;
  /** Secret: the shared project account's Gmail address, which emails are sent from. */
  GMAIL_USER?: string;
  /** Secret: an app password for that account, made at myaccount.google.com/apppasswords. */
  GMAIL_APP_PASSWORD?: string;
  /** Secret: only if EMAIL_PROVIDER is brevo. */
  BREVO_API_KEY?: string;
  PHOTOS: KVNamespace;
  BACKUPS: KVNamespace;
  /** The queue that runs scheduled tasks and bulk work (NKB-118). */
  JOBS: Queue<JobMessage>;
}

// The emulators accept unsigned tokens, so emulator mode needs both the emulator setting and a
// demo- project ID, which Firebase reserves for projects that do not exist.
export function isDemoProject(env: Env): boolean {
  return env.FIREBASE_PROJECT_ID.startsWith('demo-');
}
