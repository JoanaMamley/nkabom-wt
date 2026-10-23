import { isDemoProject, type Env } from './env';
import { getAccessToken } from './google';

// Firestore's REST API (v1). The emulator takes "owner" as a token that bypasses the rules, as the
// service account does on a real project.
export async function getDocument(env: Env, path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(documentUrl(env, path), { headers: await authHeaders(env) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Firestore read of ${path} failed: ${response.status} ${await response.text()}`,
    );
  }
  const document = (await response.json()) as { fields?: Record<string, FirestoreValue> };
  return decodeFields(document.fields ?? {});
}

function documentUrl(env: Env, path: string): string {
  const base =
    env.FIRESTORE_EMULATOR_HOST && isDemoProject(env)
      ? `http://${env.FIRESTORE_EMULATOR_HOST}/v1`
      : 'https://firestore.googleapis.com/v1';
  const segments = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${segments}`;
}

async function authHeaders(env: Env): Promise<HeadersInit> {
  if (env.FIRESTORE_EMULATOR_HOST && isDemoProject(env)) {
    return { Authorization: 'Bearer owner' };
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT is not set');
  }
  return { Authorization: `Bearer ${await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT)}` };
}

// A Firestore value is an object with one key naming its type.
export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { bytesValue: string }
  | { referenceValue: string }
  | { geoPointValue: { latitude: number; longitude: number } }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

// Timestamps become Dates and integers numbers; member data has no integers beyond 2^53.
export function decodeValue(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  return decodeFields(value.mapValue.fields ?? {});
}
