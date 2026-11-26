import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';

// Runs scripts/create-primary-admin.mjs against the Auth and Firestore emulators, which
// npm run test:rules starts.
const PROJECT = 'demo-nkabom';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;
const FIRESTORE = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(...args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await promisify(execFile)('node', [
      'scripts/create-primary-admin.mjs',
      '--project',
      PROJECT,
      ...args,
    ]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as Run;
    return { code, stdout, stderr };
  }
}

interface Account {
  localId: string;
  email: string;
  displayName?: string;
  emailVerified?: boolean;
  passwordUpdatedAt?: number;
  customAttributes?: string;
}

async function accounts(): Promise<Account[]> {
  const response = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`,
    { method: 'POST', headers: OWNER, body: JSON.stringify({}) },
  );
  return ((await response.json()) as { userInfo?: Account[] }).userInfo ?? [];
}

async function usersRecord(uid: string): Promise<Record<string, Record<string, string>> | null> {
  const response = await fetch(
    `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`,
    { headers: OWNER },
  );
  return response.ok ? ((await response.json()) as { fields: never }).fields : null;
}

const AMA = ['--email', 'ama@example.com', '--name', 'Ama Mensah'];

// Each test starts from empty emulators, as a fresh project does.
beforeEach(async () => {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
});

describe('create-primary-admin (FR-1.6)', () => {
  it('creates the first Primary Admin on a fresh project, with the role claim', async () => {
    const result = await run(...AMA, '--calendar-email', 'ama@gmail.com');
    expect(result.code).toBe(0);

    const [account] = await accounts();
    expect(account).toMatchObject({
      email: 'ama@example.com',
      displayName: 'Ama Mensah',
      emailVerified: true,
    });
    expect(JSON.parse(account.customAttributes ?? '{}')).toEqual({ role: 'primaryAdmin' });
    // A password is set, so "Forgot password?" works for the account (NKB-203).
    expect(account.passwordUpdatedAt).toBeGreaterThan(0);
    expect(result.stdout).toContain(account.localId);

    const record = await usersRecord(account.localId);
    expect(record).toMatchObject({
      role: { stringValue: 'primaryAdmin' },
      email: { stringValue: 'ama@example.com' },
      name: { stringValue: 'Ama Mensah' },
      calendarEmail: { stringValue: 'ama@gmail.com' },
    });
    expect(record?.['createdAt']?.['timestampValue']).toBeTruthy();
  });

  it('uses the login address for the calendar unless told otherwise', async () => {
    await run(...AMA);
    const [account] = await accounts();
    expect((await usersRecord(account.localId))?.['calendarEmail']).toEqual({
      stringValue: 'ama@example.com',
    });
  });

  it('refuses a second Primary Admin, saying so and changing nothing', async () => {
    expect((await run(...AMA)).code).toBe(0);
    const result = await run('--email', 'kofi@example.com', '--name', 'Kofi Boateng');

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('already has a Primary Admin (ama@example.com)');
    expect((await accounts()).map(({ email }) => email)).toEqual(['ama@example.com']);
  });

  it('refuses an address that already has an account, saying so and changing nothing', async () => {
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({ email: 'ama@example.com', password: 'a member password' }),
    });
    const result = await run(...AMA);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ama@example.com already has an account');
    const [account] = await accounts();
    expect(account.customAttributes).toBeUndefined();
    expect(await usersRecord(account.localId)).toBeNull();
  });

  it('says when a Primary Admin record has no account, rather than naming someone who cannot log in', async () => {
    await fetch(
      `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/users?documentId=gone`,
      {
        method: 'POST',
        headers: OWNER,
        body: JSON.stringify({
          fields: {
            role: { stringValue: 'primaryAdmin' },
            email: { stringValue: 'efua@example.com' },
          },
        }),
      },
    );
    const result = await run(...AMA);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('record for efua@example.com (users/gone), but no account');
    expect(await accounts()).toEqual([]);
  });

  it('stores the addresses in lower case, as Firebase Auth does', async () => {
    await run(
      '--email',
      'Ama@Example.com',
      '--name',
      'Ama Mensah',
      '--calendar-email',
      'Ama@Gmail.com',
    );
    const [account] = await accounts();
    expect(account.email).toBe('ama@example.com');
    expect(await usersRecord(account.localId)).toMatchObject({
      email: { stringValue: 'ama@example.com' },
      calendarEmail: { stringValue: 'ama@gmail.com' },
    });
  });

  it('needs an email address and a name', async () => {
    for (const args of [
      ['--name', 'Ama Mensah'],
      ['--email', 'not an address', '--name', 'Ama Mensah'],
      ['--email', 'ama@example.com'],
    ]) {
      expect((await run(...args)).code).not.toBe(0);
    }
    expect(await accounts()).toEqual([]);
  });

  it('never prints the password', async () => {
    const result = await run(...AMA);
    expect(result.stdout).not.toMatch(/password:/i);
    expect(result.stdout + result.stderr).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});
