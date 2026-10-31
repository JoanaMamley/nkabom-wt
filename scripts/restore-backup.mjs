// Restores a Firestore backup made by the Worker's daily backup (NKB-119, worker/src/backups.ts).
// It reads the backup from Workers KV through Wrangler (Cloudflare's API, signed in as the shared
// account), writes every document to the target, then reads each one back and checks it matches.
// See the README, Backups, for when to use which target.
//
//   node scripts/restore-backup.mjs --from staging                 # latest, into the emulator
//   node scripts/restore-backup.mjs --from staging --backup 2026-10-24T02:00:00Z
//   node scripts/restore-backup.mjs --from production --to nkabom-prod --key ~/Downloads/key.json
//
// --from    staging, production, or local (wrangler dev's KV; add --persist-to if it uses one)
// --backup  a backup ID, or latest (the default)
// --to      emulator (the default), or a project ID
// --project the emulator project to restore into (default demo-restore, so local data is kept)
// --key     for a project: its service account key file, as for the Worker (see the README)
//
// The emulator target is emptied first, so the check also finds documents that should not be
// there. A project is never emptied: documents created since the backup stay as they are.
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    from: { type: 'string' },
    backup: { type: 'string', default: 'latest' },
    to: { type: 'string', default: 'emulator' },
    project: { type: 'string', default: 'demo-restore' },
    key: { type: 'string' },
    'persist-to': { type: 'string' },
  },
});

const ENVIRONMENTS = ['staging', 'production', 'local'];
if (!ENVIRONMENTS.includes(args.from)) {
  fail(`--from must be one of ${ENVIRONMENTS.join(', ')}`);
}

// Firestore's limit on writes in one commit.
const WRITES_PER_COMMIT = 500;
const READS_PER_CALL = 100;

// --- Reading the backup through Wrangler ---

// Wrangler's output, or null when the key does not exist (a 404 from Cloudflare, or "Value not
// found" from the local store). Its warnings are shown only if it fails some other way.
function wrangler(...command) {
  const where =
    args.from === 'local'
      ? ['--local', ...(args['persist-to'] ? ['--persist-to', args['persist-to']] : [])]
      : ['--remote', '--env', args.from];
  try {
    return execFileSync('npx', ['wrangler', 'kv', ...command, '--binding', 'BACKUPS', ...where], {
      cwd: new URL('../worker/', import.meta.url),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (/404: Not Found/.test(error.stderr ?? '')) {
      return null;
    }
    fail(`npx wrangler kv ${command.join(' ')} failed:\n${error.stderr ?? error.message}`);
  }
}

function listKeys(prefix) {
  return JSON.parse(wrangler('key', 'list', '--prefix', prefix)).map(({ name }) => name);
}

function getJson(key) {
  const text = wrangler('key', 'get', key, '--text')?.trim();
  return !text || text === 'Value not found' ? null : JSON.parse(text);
}

// --- Writing to Firestore ---

const target =
  args.to === 'emulator'
    ? {
        projectId: args.project,
        base: `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}/v1`,
        token: 'owner',
      }
    : {
        projectId: args.to,
        base: 'https://firestore.googleapis.com/v1',
        token: await googleToken(),
      };

if (args.to === 'emulator' && !target.projectId.startsWith('demo-')) {
  fail('--project must be a demo- project when restoring into the emulator');
}

const database = `projects/${target.projectId}/databases/(default)`;

async function firestore(method, path, body) {
  const response = await fetch(`${target.base}/${database}${path}`, {
    method,
    headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!response.ok) {
    fail(`Firestore ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// A Google access token for the service account in --key, as the Worker gets one (google.ts).
async function googleToken() {
  if (!args.key) {
    fail('Restoring into a project needs --key with its service account key file');
  }
  const account = JSON.parse(readFileSync(args.key, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(account.private_key, 'base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) {
    fail(`Google token request failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).access_token;
}

// Same fields and values, whatever order the maps' keys come in.
function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// --- The restore ---

const backupId = args.backup === 'latest' ? getJson('firestore/latest')?.backupId : args.backup;
if (!backupId) {
  fail(`No backups in ${args.from}`);
}
const manifest = getJson(`firestore/${backupId}/manifest`);
if (!manifest) {
  fail(`Backup ${backupId} has no manifest: it did not finish, or it has expired`);
}
console.log(`Backup ${backupId} from ${args.from}, finished ${manifest.finishedAt}`);

// Every page of the backup, and every audit log increment up to it: the audit log is backed up
// incrementally and its increments never expire.
const pageKeys = listKeys(`firestore/${backupId}/`).filter((key) => !key.endsWith('/manifest'));
const auditKeys = listKeys('auditLog/').filter((key) => key.split('/')[1] <= backupId);
const documents = new Map();
for (const key of [...pageKeys, ...auditKeys]) {
  for (const { path, fields } of getJson(key)) {
    // An entry in two increments (from a backup that stopped part-way) is the same both times.
    documents.set(path, fields);
  }
}

const count = (paths) =>
  paths.reduce((counts, path) => {
    const collection = path.split('/')[0];
    return { ...counts, [collection]: (counts[collection] ?? 0) + 1 };
  }, {});
const counts = count([...documents.keys()]);
console.log('Documents in the backup:', counts);
const expected = { ...manifest.documents };
const auditTotal = counts.auditLog ?? 0;
delete expected.auditLog;
for (const [collection, number] of Object.entries(expected)) {
  if (number > 0 && counts[collection] !== number) {
    fail(
      `The manifest says ${number} ${collection} documents, but the pages hold ${counts[collection] ?? 0}`,
    );
  }
}

if (args.to === 'emulator') {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const response = await fetch(`http://${host}/emulator/v1/${database}/documents`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    fail(`Could not empty the emulator project ${target.projectId}: is the emulator running?`);
  }
} else {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question(
    `This overwrites ${documents.size} documents in ${target.projectId}. Type the project ID to go on: `,
  );
  readline.close();
  if (answer.trim() !== target.projectId) {
    fail('Stopped: nothing was written');
  }
}

const entries = [...documents];
for (let i = 0; i < entries.length; i += WRITES_PER_COMMIT) {
  await firestore('POST', '/documents:commit', {
    writes: entries
      .slice(i, i + WRITES_PER_COMMIT)
      .map(([path, fields]) => ({ update: { name: `${database}/documents/${path}`, fields } })),
  });
}
console.log(
  `Wrote ${entries.length} documents to ${args.to === 'emulator' ? `the emulator (${target.projectId})` : target.projectId}`,
);

// The check: every document reads back with the same fields.
let mismatches = 0;
for (let i = 0; i < entries.length; i += READS_PER_CALL) {
  const chunk = entries.slice(i, i + READS_PER_CALL);
  const results = await firestore('POST', '/documents:batchGet', {
    documents: chunk.map(([path]) => `${database}/documents/${path}`),
  });
  const found = new Map(
    results.filter((result) => result.found).map(({ found }) => [found.name, found.fields ?? {}]),
  );
  for (const [path, fields] of chunk) {
    const actual = found.get(`${database}/documents/${path}`);
    if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(fields))) {
      console.error(`Does not match the backup: ${path}`);
      mismatches++;
    }
  }
}

// In the emptied emulator, nothing else may be there.
let extra = 0;
if (args.to === 'emulator') {
  const { collectionIds = [] } = await firestore('POST', '/documents:listCollectionIds', {});
  for (const collection of collectionIds) {
    let pageToken;
    do {
      const query = new URLSearchParams({ pageSize: '300', ...(pageToken && { pageToken }) });
      const page = await firestore('GET', `/documents/${collection}?${query}`);
      for (const { name } of page.documents ?? []) {
        if (!documents.has(name.split('/documents/')[1])) {
          console.error(`Not in the backup: ${name}`);
          extra++;
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
}

if (mismatches > 0 || extra > 0) {
  fail(`Check failed: ${mismatches} documents differ, ${extra} are not in the backup`);
}
console.log(
  `Check passed: all ${entries.length} documents match the backup, ${auditTotal} of them audit log entries`,
);
