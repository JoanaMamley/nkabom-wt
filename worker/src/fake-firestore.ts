import {
  decodeFields,
  decodeValue,
  encodeFields,
  type Fields,
  type FirestoreValue,
} from './firestore';

interface StructuredQuery {
  from: [{ collectionId: string }];
  where?: { fieldFilter: { field: { fieldPath: string }; op: 'EQUAL'; value: FirestoreValue } };
  orderBy?: { field: { fieldPath: string }; direction: 'ASCENDING' }[];
  startAt?: { values: FirestoreValue[]; before: boolean };
  limit?: number;
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
      const [path, search] = rest.slice(1).split('?');
      if (path.split('/').length % 2 === 1) {
        return this.listDocuments(url, decodeURIComponent(path), new URLSearchParams(search));
      }
      const fields = this.docs.get(decodeURIComponent(path));
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
      case ':listCollectionIds':
        return Response.json({
          collectionIds: [...new Set([...this.docs.keys()].map((path) => path.split('/')[0]))],
        });
      case ':runQuery':
        return this.runQuery(url, body['structuredQuery'] as StructuredQuery);
      case ':commit':
        return this.commit(body['writes'] as EncodedWrite[], body['transaction'] as string);
      default:
        return error(404, 'NOT_FOUND', 'Not found');
    }
  }

  // Pages of a collection in path order; the page token is where the next page starts.
  private listDocuments(url: string, collection: string, query: URLSearchParams): Response {
    const prefix = this.documentsPrefix(url);
    const all = this.inCollection(collection).sort(([a], [b]) => (a < b ? -1 : 1));
    const start = Number(query.get('pageToken') ?? 0);
    const end = start + Number(query.get('pageSize') ?? 300);
    return Response.json({
      documents: all.slice(start, end).map(([path, fields]) => ({
        name: `${prefix}/${path}`,
        fields: encodeFields(fields),
      })),
      ...(end < all.length && { nextPageToken: String(end) }),
    });
  }

  // What findDocuments and listDocumentsAfter send: one EQUAL filter, or an order by one field
  // and then the name, a start after a document, and a limit.
  private runQuery(url: string, query: StructuredQuery): Response {
    const prefix = this.documentsPrefix(url);
    const [{ collectionId }] = query.from;
    let matches = this.inCollection(collectionId);
    if (query.where) {
      const { field, value } = query.where.fieldFilter;
      const wanted = decodeValue(value);
      matches = matches.filter(([, fields]) => fields[field.fieldPath] === wanted);
    }
    const order = query.orderBy?.[0]?.field.fieldPath;
    if (order) {
      const key = ([path, fields]: [string, Fields]) =>
        [(fields[order] as Date).getTime(), `${prefix}/${path}`] as const;
      matches.sort((a, b) => {
        const [x, y] = [key(a), key(b)];
        return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
      });
      if (query.startAt) {
        const [time, name] = query.startAt.values.map(decodeValue) as [Date, string];
        matches = matches.filter((match) => {
          const [t, n] = key(match);
          return t > time.getTime() || (t === time.getTime() && n > name);
        });
      }
    }
    if (query.limit !== undefined) {
      matches = matches.slice(0, query.limit);
    }
    return Response.json([
      ...matches.map(([path, fields]) => ({
        document: { name: `${prefix}/${path}`, fields: encodeFields(fields) },
      })),
      { readTime: this.now.toISOString() },
    ]);
  }

  private inCollection(collection: string): [string, Fields][] {
    return [...this.docs].filter(
      ([path]) => path.split('/').length === 2 && path.startsWith(`${collection}/`),
    );
  }

  // projects/{id}/databases/(default)/documents, from any of the API's URLs.
  private documentsPrefix(url: string): string {
    return `${url.replace(/^https?:\/\/[^/]+\/v1\//, '').split('/documents')[0]}/documents`;
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
