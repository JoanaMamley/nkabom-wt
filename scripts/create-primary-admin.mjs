// Creates the first Primary Admin (FR-1.6, NKB-207), once, when a project is set up. Later admins
// are created in the app by a Primary Admin (NKB-208). See the README, First Primary Admin.
//
//   node scripts/create-primary-admin.mjs --email ama@example.com --name "Ama Mensah"
//   node scripts/create-primary-admin.mjs --project nkabom-prod --key ~/Downloads/key.json \
//     --email ama@example.com --name "Ama Mensah" --calendar-email ama@gmail.com
//
// --email           the address they log in with
// --name            their name, as admins and the audit log show it
// --calendar-email  the Google account for the birthday calendar (default: --email)
// --project         a project ID (default demo-nkabom, the emulators that npm start runs)
// --key             for a real project: its service account key file, as for the Worker
//
// It refuses, and changes nothing, if the project already has a Primary Admin or the address
// already has an account. The account gets a random password that no one sees and its email marked
// verified, as the Worker and the rules require (NKB-202); the Primary Admin sets their own
// password with "Forgot password?" on the login page (NKB-203), which also proves the address.
import { createSign, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'calendar-email': { type: 'string' },
    project: { type: 'string', default: 'demo-nkabom' },
    key: { type: 'string' },
  },
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Lower case, as Firebase Auth stores addresses and the Worker copies them into users records.
const email = args.email?.trim().toLowerCase() ?? '';
const name = args.name?.trim() ?? '';
const calendarEmail = args['calendar-email']?.trim().toLowerCase() || email;
if (!EMAIL.test(email)) {
  fail('--email must be an email address');
}
if (!name) {
  fail('--name is required');
}
if (!EMAIL.test(calendarEmail)) {
  fail('--calendar-email must be an email address');
}

// demo- projects exist only in the emulators, which take "owner" as a token with admin rights.
const projectId = args.project;
const emulated = projectId.startsWith('demo-');
const token = emulated ? 'owner' : await googleToken();
const authBase = emulated
  ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}/identitytoolkit.googleapis.com/v1`
  : 'https://identitytoolkit.googleapis.com/v1';
const firestoreBase = emulated
  ? `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}/v1`
  : 'https://firestore.googleapis.com/v1';
const database = `projects/${projectId}/databases/(default)`;

async function call(url, body, what) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    fail(
      `${what} failed: ${error.cause?.message ?? error.message}${emulated ? '. Are the emulators running?' : ''}`,
    );
  }
  if (!response.ok) {
    throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

const auth = (method, body) =>
  call(
    `${authBase}/projects/${projectId}/accounts${method}`,
    body,
    `Firebase Auth ${method || 'create'}`,
  );
const firestore = (method, body) =>
  call(`${firestoreBase}/${database}/documents:${method}`, body, `Firestore ${method}`);

// A Google access token for the service account in --key, as the Worker gets one (google.ts).
async function googleToken() {
  if (!args.key) {
    fail('A real project needs --key with its service account key file');
  }
  const account = JSON.parse(readFileSync(args.key, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

// --- Checks: nothing is written unless all pass ---

const [existing] = await firestore('runQuery', {
  structuredQuery: {
    from: [{ collectionId: 'users' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'role' },
        op: 'EQUAL',
        value: { stringValue: 'primaryAdmin' },
      },
    },
    limit: 1,
  },
});
if (existing?.document) {
  const record = existing.document;
  const uid = record.name.split('/').pop();
  const who = record.fields?.email?.stringValue ?? uid;
  const { users: [account] = [] } = await auth(':lookup', { localId: [uid] });
  fail(
    account
      ? `Stopped: ${projectId} already has a Primary Admin (${who}), so nothing was changed. ` +
          'Further admins are created in the app by a Primary Admin.'
      : `Stopped: ${projectId} has a Primary Admin record for ${who} (users/${uid}), but no account ` +
          'for it, so nothing was changed. If that record is left over, delete it in the Firebase ' +
          'console and run this again.',
  );
}

const { users: [taken] = [] } = await auth(':lookup', { email: [email] });
if (taken) {
  fail(
    `Stopped: ${email} already has an account (${taken.localId}) in ${projectId}, so nothing was ` +
      'changed. Use another address, or delete that account first in the Firebase console.',
  );
}

if (!emulated) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question(
    `This makes ${email} the Primary Admin of ${projectId}. Type the project ID to go on: `,
  );
  readline.close();
  if (answer.trim() !== projectId) {
    fail('Stopped: nothing was changed');
  }
}

// --- Creating the account ---

const { localId: uid } = await auth('', {
  email,
  displayName: name,
  password: randomBytes(32).toString('base64url'),
  emailVerified: true,
});

// The users record, created only if it does not exist, makes the account a Primary Admin: the
// Worker and the rules read the role from it (NKB-204). If it fails, the account is removed again,
// so the script can simply be run again.
try {
  await firestore('commit', {
    writes: [
      {
        update: {
          name: `${database}/documents/users/${uid}`,
          fields: {
            role: { stringValue: 'primaryAdmin' },
            email: { stringValue: email },
            name: { stringValue: name },
            calendarEmail: { stringValue: calendarEmail },
          },
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      },
    ],
  });
} catch (error) {
  await auth(':delete', { localId: uid }).catch(() => {});
  fail(`${error.message}\nThe account was removed again, so nothing was changed.`);
}

// The role claim the rules read from the ID token (NKB-204). Not fatal: the Worker sets it on the
// account's first call if it is missing (syncRoleClaim in worker/src/users.ts).
try {
  await auth(':update', {
    localId: uid,
    customAttributes: JSON.stringify({ role: 'primaryAdmin' }),
  });
} catch (error) {
  console.warn(`${error.message}\nThe Worker sets the role claim on their first call instead.`);
}

console.log(
  `Created the Primary Admin ${name} <${email}> (${uid}) in ${projectId}.\n` +
    'They set their password with "Forgot password?" on the login page, then log in.',
);
