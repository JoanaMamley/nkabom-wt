import {
  decodeFields,
  decodeValue,
  encodeFields,
  type Fields,
  type FirestoreValue,
} from './firestore';

interface StructuredQuery {
  from: [{ collectionId: string }];
  where: { fieldFilter: { field: { fieldPath: string }; op: 'EQUAL'; value: FirestoreValue } };
}

interface EncodedWrite {
  update?: { name: string; fields?: Record<string, FirestoreValue> };
  delete?: string;
  updateMask?: { fieldPaths: string[] };
  currentDocument?: { exists: boolean };
  updateTransforms?: { fieldPath: string; setToServerValue: 'REQUEST_TIME' }[];
}

/**
 * Firestore's REST API in memory, for tests: document reads, batchGet, transactions and commits,
 * with the preconditions, server times and error answers the Firestore emulator gives. A commit
 * applies all its writes or none. Documents are held decoded, keyed by path such as users/ama.
 */
export class FakeFirestore {
  readonly docs = new Map<string, Fields>();
  /** The writes of each successful commit, as sent. */
  readonly commits: EncodedWrite[][] = [];
  /** How many commits to answer ABORTED, as when a transaction clashes with another. */
  abortCommits = 0;
  /** The time server-time fields get. */
  now = new Date('2026-10-23T10:00:00.000Z');
  private readonly open = new Set<string>();
  private lastTransaction = 0;

  /** Transactions begun and not yet committed or rolled back. */
  get openTransactions(): number {
    return this.open.size;
  }

  handles(url: string): boolean {
    return /\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents/.test(url);
  }

  async handle(url: string, init: RequestInit = {}): Promise<Response> {
    const [, rest] = url.split('/databases/(default)/documents');
    if (!init.method || init.method === 'GET') {
      const fields = this.docs.get(decodeURIComponent(rest.slice(1)));
      return fields
        ? Response.json({ fields: encodeFields(fields) })
        : error(404, 'NOT_FOUND', 'Document not found.');
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    switch (rest) {
      case ':beginTransaction': {
        const transaction = `tx${++this.lastTransaction}`;
        this.open.add(transaction);
        return Response.json({ transaction });
      }
      case ':rollback':
        this.open.delete(body['transaction'] as string);
        return Response.json({});
      case ':batchGet':
        return Response.json(
          (body['documents'] as string[]).map((name) => {
            const fields = this.docs.get(pathOf(name));
            return fields ? { found: { name, fields: encodeFields(fields) } } : { missing: name };
          }),
        );
      case ':runQuery':
        return this.runQuery(url, body['structuredQuery'] as StructuredQuery);
      case ':commit':
        return this.commit(body['writes'] as EncodedWrite[], body['transaction'] as string);
      default:
        return error(404, 'NOT_FOUND', 'Not found');
    }
  }

  // Only what findDocuments sends: one collection and one EQUAL filter.
  private runQuery(url: string, query: StructuredQuery): Response {
    const [{ collectionId }] = query.from;
    const { field, value } = query.where.fieldFilter;
    const wanted = decodeValue(value);
    const prefix = url.split(':runQuery')[0].replace(/^https?:\/\/[^/]+\/v1\//, '');
    const matches = [...this.docs].filter(
      ([path, fields]) =>
        path.split('/').length === 2 &&
        path.startsWith(`${collectionId}/`) &&
        fields[field.fieldPath] === wanted,
    );
    return Response.json([
      ...matches.map(([path, fields]) => ({
        document: { name: `${prefix}/${path}`, fields: encodeFields(fields) },
      })),
      { readTime: this.now.toISOString() },
    ]);
  }

  private commit(writes: EncodedWrite[], transaction: string | undefined): Response {
    if (transaction) {
      if (!this.open.delete(transaction)) {
        return error(
          409,
          'ABORTED',
          'The referenced transaction has expired or is no longer valid.',
        );
      }
      if (this.abortCommits > 0) {
        this.abortCommits--;
        return error(409, 'ABORTED', 'Transaction lock timeout.');
      }
    }
    const docs = new Map(this.docs);
    for (const write of writes) {
      if (write.delete) {
        docs.delete(pathOf(write.delete));
        continue;
      }
      const path = pathOf(write.update!.name);
      const exists = docs.has(path);
      if (write.currentDocument?.exists === false && exists) {
        return error(409, 'ALREADY_EXISTS', `entity already exists: ${path}`);
      }
      if (write.currentDocument?.exists === true && !exists) {
        return error(404, 'NOT_FOUND', `no entity to update: ${path}`);
      }
      const fields = decodeFields(write.update!.fields ?? {});
      let doc: Fields = fields;
      if (write.updateMask) {
        doc = { ...docs.get(path) };
        for (const field of write.updateMask.fieldPaths) {
          if (field in fields) {
            doc[field] = fields[field];
          } else {
            delete doc[field];
          }
        }
      }
      for (const { fieldPath } of write.updateTransforms ?? []) {
        doc[fieldPath] = this.now;
      }
      docs.set(path, doc);
    }
    this.docs.clear();
    docs.forEach((fields, path) => this.docs.set(path, fields));
    this.commits.push(writes);
    return Response.json({ commitTime: this.now.toISOString() });
  }
}

function pathOf(name: string): string {
  return name.split('/databases/(default)/documents/')[1];
}

function error(code: number, status: string, message: string): Response {
  return Response.json({ error: { code, message, status } }, { status: code });
}
