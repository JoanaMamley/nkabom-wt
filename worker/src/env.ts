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
  PHOTOS: KVNamespace;
  BACKUPS: KVNamespace;
}

// The emulators accept unsigned tokens, so emulator mode needs both the emulator setting and a
// demo- project ID, which Firebase reserves for projects that do not exist.
export function isDemoProject(env: Env): boolean {
  return env.FIREBASE_PROJECT_ID.startsWith('demo-');
}
