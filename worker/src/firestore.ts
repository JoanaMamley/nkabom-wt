import { isDemoProject, type Env } from './env';
import { getAccessToken } from './google';

// Firestore's REST API (v1). The emulator takes "owner" as a token that bypasses the rules, as the
// service account does on a real project.

/** A field value that stores the time Firestore commits the write, like serverTimestamp(). */
export const SERVER_TIME = Symbol('server time');

export type Fields = Record<string, unknown>;

/** A failed Firestore call. status is Firestore's code, such as ABORTED or ALREADY_EXISTS. */
export class FirestoreError extends Error {
  constructor(
    readonly status: string,
    message: string,
  ) {
    super(message);
  }
}

export async function getDocument(env: Env, path: string): Promise<Fields | null> {
  const response = await fetch(documentUrl(env, path), { headers: await authHeaders(env) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await firestoreError(response, `read of ${path}`);
  }
  const document = (await response.json()) as { fields?: Record<string, FirestoreValue> };
  return decodeFields(document.fields ?? {});
}

type Write =
  { op: 'create' | 'set' | 'update'; path: string; data: Fields } | { op: 'delete'; path: string };

/** Writes for one commit, which applies all of them or none. Field names must be plain words. */
export class WriteBatch {
  readonly writes: Write[] = [];

  /** A new document. The commit fails with ALREADY_EXISTS if the document is there. */
  create(path: string, data: Fields): void {
    this.writes.push({ op: 'create', path, data });
  }

  /** Replaces the document, or creates it. */
  set(path: string, data: Fields): void {
    this.writes.push({ op: 'set', path, data });
  }

  /** Changes only the given fields. The commit fails with NOT_FOUND if the document is missing. */
  update(path: string, data: Fields): void {
    this.writes.push({ op: 'update', path, data });
  }

  delete(path: string): void {
    this.writes.push({ op: 'delete', path });
  }
}

/** A read-write transaction: Firestore locks what it reads until the writes commit. */
export class Transaction extends WriteBatch {
  constructor(
    private readonly env: Env,
    readonly id: string,
  ) {
    super();
  }

  /** The documents as they are now, in the order given, null for a missing one. */
  async getAll(...paths: string[]): Promise<(Fields | null)[]> {
    const results = (await post(this.env, 'batchGet', `read of ${paths.join(', ')}`, {
      documents: paths.map((path) => documentName(this.env, path)),
      transaction: this.id,
    })) as { found?: { name: string; fields?: Record<string, FirestoreValue> } }[];
    // batchGet may answer in any order.
    const documents = new Map(
      results.flatMap(({ found }) => (found ? [[found.name, found.fields ?? {}] as const] : [])),
    );
    return paths.map((path) => {
      const fields = documents.get(documentName(this.env, path));
      return fields ? decodeFields(fields) : null;
    });
  }
}

export async function commit(env: Env, batch: WriteBatch, transaction?: string): Promise<void> {
  await post(env, 'commit', `write of ${batch.writes.map(({ path }) => path).join(', ')}`, {
    writes: batch.writes.map((write) => encodeWrite(env, write)),
    ...(transaction && { transaction }),
  });
}

const MAX_ATTEMPTS = 5;

/**
 * Runs update in a transaction and commits the writes it adds, all of them or none. Do every read
 * before the first write. Firestore aborts a transaction that clashes with another, and then
 * update runs again from the start, so it must not have other side effects.
 */
export async function runTransaction<T>(
  env: Env,
  update: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let retryTransaction: string | undefined;
  for (let attempt = 1; ; attempt++) {
    const { transaction } = (await post(env, 'beginTransaction', 'transaction start', {
      options: { readWrite: retryTransaction ? { retryTransaction } : {} },
    })) as { transaction: string };
    const tx = new Transaction(env, transaction);

    let result: T;
    try {
      result = await update(tx);
    } catch (error) {
      // Firestore holds the locks until the transaction ends, so end it now.
      await post(env, 'rollback', 'rollback', { transaction }).catch(() => undefined);
      throw error;
    }
    try {
      await commit(env, tx, transaction);
      return result;
    } catch (error) {
      if (
        !(error instanceof FirestoreError && error.status === 'ABORTED') ||
        attempt >= MAX_ATTEMPTS
      ) {
        throw error;
      }
      retryTransaction = transaction;
    }
  }
}

function encodeWrite(env: Env, write: Write): unknown {
  const name = documentName(env, write.path);
  if (write.op === 'delete') {
    return { delete: name };
  }
  const entries = Object.entries(write.data);
  const values = Object.fromEntries(entries.filter(([, value]) => value !== SERVER_TIME));
  const times = entries.filter(([, value]) => value === SERVER_TIME).map(([field]) => field);
  return {
    update: { name, fields: encodeFields(values) },
    ...(write.op === 'update' && { updateMask: { fieldPaths: Object.keys(values) } }),
    ...(write.op !== 'set' && { currentDocument: { exists: write.op === 'update' } }),
    ...(times.length > 0 && {
      updateTransforms: times.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
    }),
  };
}

async function post(env: Env, method: string, what: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${databaseUrl(env)}/documents:${method}`, {
    method: 'POST',
    headers: { ...(await authHeaders(env)), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await firestoreError(response, what);
  }
  return response.json();
}

async function firestoreError(response: Response, what: string): Promise<FirestoreError> {
  const text = await response.text();
  let status = String(response.status);
  try {
    status = (JSON.parse(text) as { error: { status: string } }).error.status ?? status;
  } catch {
    // Not Firestore's JSON error, so keep the HTTP status.
  }
  return new FirestoreError(status, `Firestore ${what} failed: ${response.status} ${text}`);
}

function databaseUrl(env: Env): string {
  const base =
    env.FIRESTORE_EMULATOR_HOST && isDemoProject(env)
      ? `http://${env.FIRESTORE_EMULATOR_HOST}/v1`
      : 'https://firestore.googleapis.com/v1';
  return `${base}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`;
}

function documentUrl(env: Env, path: string): string {
  const segments = path.split('/').map(encodeURIComponent).join('/');
  return `${databaseUrl(env)}/documents/${segments}`;
}

function documentName(env: Env, path: string): string {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function authHeaders(env: Env): Promise<Record<string, string>> {
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

export function decodeFields(fields: Record<string, FirestoreValue>): Fields {
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

export function encodeFields(fields: Fields): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]),
  );
}

// The reverse of decodeValue. Whole numbers are stored as integers, so the rules and queries see
// a graduation year as an int.
export function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value as Fields) } };
  throw new Error(`Firestore cannot store a ${typeof value}`);
}
