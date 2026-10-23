import { env as bindings } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import type { FakeFirestore } from './fake-firestore';
import { runTransaction } from './firestore';
import worker from './index';
import { changeProfile, readMember } from './members';
import { MAX_YEARS_TO_GRADUATION, MIN_GRADUATION_YEAR, STAGES } from './model';
import { emulatorEnv, mockEmulators, signedIn } from './test-helpers';

// The local PHOTOS namespace from wrangler.jsonc.
const { PHOTOS } = bindings as unknown as Env;
const env = emulatorEnv({ PHOTOS });

function photoOf(uid: string, ext = 'webp') {
  return `photos/${uid}/0f8fad5b-d9cb-469f-a165-70867728950e.${ext}`;
}

const details = {
  firstNames: 'Ama Serwaa',
  surname: 'Mensah',
  dateOfBirth: '1998-02-28',
  stage: 'graduate',
  courseOrOccupation: 'Civil engineer',
  graduationYear: 2020,
  photoPath: photoOf('ama'),
};

const entry = {
  firstNames: 'Ama Serwaa',
  surname: 'Mensah',
  photoPath: photoOf('ama'),
  courseOrOccupation: 'Civil engineer',
  graduationYear: 2020,
};

const created = new Date('2026-01-01T00:00:00Z');

let firestore: FakeFirestore;

beforeEach(async () => {
  ({ firestore } = mockEmulators());
  // ama's account and uploaded photos.
  firestore.docs.set('users/ama', { role: 'member', email: 'ama@example.com' });
  for (const ext of ['jpg', 'png', 'webp']) {
    await PHOTOS.put(photoOf('ama', ext), 'photo');
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function send(method: string, path: string, body: unknown, uid: string | null = 'ama') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (uid) {
    Object.assign(headers, signedIn(uid));
  }
  const request = new Request(`https://api.test${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  }) as Request<unknown, IncomingRequestCfProperties>;
  return worker.fetch(request, env);
}

const register = (body: unknown, uid?: string | null) =>
  send('POST', '/v1/registration', body, uid);
const edit = (body: unknown, uid?: string | null) => send('PATCH', '/v1/profile', body, uid);

function seedProfile(overrides: Record<string, unknown> = {}) {
  firestore.docs.set('members/ama', {
    ...details,
    status: 'active',
    createdAt: created,
    updatedAt: created,
    ...overrides,
  });
  if ((overrides['status'] ?? 'active') === 'active') {
    firestore.docs.set('directory/ama', { ...entry });
  }
}

async function errorOf(response: Response) {
  return { status: response.status, ...((await response.json()) as { error: string }) };
}

describe('POST /v1/registration', () => {
  it('creates the caller’s profile as pending, with server times', async () => {
    const response = await register({ ...details, firstNames: '  Ama Serwaa ' });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: 'pending' });
    expect(firestore.docs.get('members/ama')).toEqual({
      ...details,
      status: 'pending',
      createdAt: firestore.now,
      updatedAt: firestore.now,
    });
  });

  it('does not list a pending member, and removes an entry left from before', async () => {
    firestore.docs.set('directory/ama', { ...entry });

    await register(details);

    expect(firestore.docs.has('directory/ama')).toBe(false);
    // One commit: the profile and the directory change are saved together.
    expect(firestore.commits).toHaveLength(1);
  });

  it('creates the users record too, for a new account', async () => {
    firestore.docs.delete('users/ama');

    await register(details);

    expect(firestore.docs.get('users/ama')).toMatchObject({ role: 'member' });
  });

  it('allows only one profile per user', async () => {
    seedProfile();

    const response = await register({ ...details, surname: 'Owusu' });

    expect(await errorOf(response)).toEqual({ status: 409, error: 'You have already registered' });
    expect(firestore.docs.get('members/ama')).toMatchObject({ surname: 'Mensah' });
  });

  it('accepts both stages', async () => {
    for (const stage of STAGES) {
      firestore.docs.delete('members/ama');
      expect((await register({ ...details, stage })).status).toBe(201);
    }
  });

  it('accepts each photo type', async () => {
    for (const ext of ['jpg', 'png', 'webp']) {
      firestore.docs.delete('members/ama');
      expect((await register({ ...details, photoPath: photoOf('ama', ext) })).status).toBe(201);
    }
  });

  it('accepts the ends of the graduation year range', async () => {
    const last = new Date().getUTCFullYear() + MAX_YEARS_TO_GRADUATION;
    for (const graduationYear of [MIN_GRADUATION_YEAR, last]) {
      firestore.docs.delete('members/ama');
      expect((await register({ ...details, graduationYear })).status).toBe(201);
    }
  });

  it('refuses any status, so members cannot approve themselves', async () => {
    const response = await register({ ...details, status: 'active' });

    expect(await errorOf(response)).toEqual({ status: 400, error: 'status cannot be set' });
    expect(firestore.docs.has('members/ama')).toBe(false);
  });

  it('refuses missing and extra fields', async () => {
    const withoutPhoto: Record<string, unknown> = { ...details };
    delete withoutPhoto['photoPath'];

    expect(await errorOf(await register(withoutPhoto))).toEqual({
      status: 400,
      error: 'photoPath is required',
    });
    expect((await register({ ...details, role: 'admin' })).status).toBe(400);
    expect((await register({ ...details, createdAt: '2020-01-01' })).status).toBe(400);
  });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  it.each([
    ['a blank first name', { firstNames: '  ' }, 'First names must be 1 to 100 characters'],
    ['a surname over 100 characters', { surname: 'a'.repeat(101) }, 'Surname'],
    ['a first name that is not text', { firstNames: 7 }, 'First names'],
    ['a date of birth in another format', { dateOfBirth: '29/02/1998' }, 'Date of birth'],
    ['month 13', { dateOfBirth: '1998-13-01' }, 'Date of birth'],
    ['day 32', { dateOfBirth: '1998-01-32' }, 'Date of birth'],
    ['31 April', { dateOfBirth: '1998-04-31' }, 'Date of birth'],
    ['29 February in a common year', { dateOfBirth: '1998-02-29' }, 'Date of birth'],
    ['a date of birth today', { dateOfBirth: today }, 'Date of birth'],
    ['a date of birth in the future', { dateOfBirth: tomorrow }, 'Date of birth'],
    ['a date of birth before 1900', { dateOfBirth: '1899-12-31' }, 'Date of birth'],
    ['an unknown stage', { stage: 'retired' }, 'Stage must be student or graduate'],
    ['a blank course or occupation', { courseOrOccupation: '' }, 'Course or occupation'],
    [
      'a graduation year before the range',
      { graduationYear: MIN_GRADUATION_YEAR - 1 },
      'Graduation year',
    ],
    [
      'a graduation year after the range',
      { graduationYear: new Date().getUTCFullYear() + MAX_YEARS_TO_GRADUATION + 1 },
      'Graduation year',
    ],
    ['a fractional graduation year', { graduationYear: 2020.5 }, 'Graduation year'],
    ['a graduation year as text', { graduationYear: '2020' }, 'Graduation year'],
    ['a blank photo path', { photoPath: '' }, 'Upload your photo first'],
    ["another member's photo", { photoPath: photoOf('kofi') }, 'Upload your photo first'],
    [
      'a photo name not issued by the upload link',
      { photoPath: 'photos/ama/profile.webp' },
      'Upload your photo first',
    ],
    ['a photo path with a prefix', { photoPath: `x/${photoOf('ama')}` }, 'Upload your photo first'],
    ['a photo of another type', { photoPath: photoOf('ama', 'svg') }, 'Upload your photo first'],
    ['a photo URL', { photoPath: `https://example.com/${photoOf('ama')}` }, 'Upload your photo'],
    [
      'a photo that was never uploaded',
      { photoPath: 'photos/ama/00000000-0000-0000-0000-000000000000.webp' },
      'Upload your photo first',
    ],
  ])('refuses %s', async (_case, overrides, message) => {
    const response = await register({ ...details, ...overrides });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(message);
    expect(firestore.docs.has('members/ama')).toBe(false);
  });

  it('accepts 29 February in a leap year', async () => {
    expect((await register({ ...details, dateOfBirth: '2000-02-29' })).status).toBe(201);
  });

  it('needs a sign-in', async () => {
    expect((await register(details, null)).status).toBe(401);
  });

  it('only allows POST', async () => {
    expect((await send('PUT', '/v1/registration', details)).status).toBe(405);
  });
});

describe('PATCH /v1/profile', () => {
  it('changes the given fields and the last-updated time, keeping the rest', async () => {
    seedProfile();

    const response = await edit({ surname: ' Owusu ', stage: 'student' });

    expect(response.status).toBe(204);
    expect(firestore.docs.get('members/ama')).toEqual({
      ...details,
      surname: 'Owusu',
      stage: 'student',
      status: 'active',
      createdAt: created,
      updatedAt: firestore.now,
    });
  });

  it('updates an active member’s directory entry in the same commit', async () => {
    seedProfile();

    await edit({ courseOrOccupation: 'Site manager' });

    expect(firestore.docs.get('directory/ama')).toEqual({
      ...entry,
      courseOrOccupation: 'Site manager',
    });
    expect(firestore.commits).toHaveLength(1);
    expect(firestore.commits[0]).toHaveLength(2);
  });

  it('leaves the directory alone when only unlisted fields change', async () => {
    seedProfile();

    await edit({ dateOfBirth: '1998-03-01' });

    expect(firestore.commits[0]).toHaveLength(1);
  });

  it('does not list a pending member', async () => {
    seedProfile({ status: 'pending' });

    await edit({ surname: 'Owusu' });

    expect(firestore.docs.has('directory/ama')).toBe(false);
  });

  it('confirms the details with an empty body, setting only the last-updated time', async () => {
    seedProfile();

    expect((await edit({})).status).toBe(204);

    expect(firestore.docs.get('members/ama')).toMatchObject({
      ...details,
      updatedAt: firestore.now,
    });
  });

  it('accepts a new photo the member has uploaded', async () => {
    seedProfile();

    await edit({ photoPath: photoOf('ama', 'png') });

    expect(firestore.docs.get('directory/ama')).toMatchObject({ photoPath: photoOf('ama', 'png') });
  });

  it.each([
    ['status', { status: 'active' }, 'status cannot be set'],
    ['the registration time', { createdAt: '2020-01-01' }, 'createdAt cannot be set'],
    ['a blank surname', { surname: '' }, 'Surname must be 1 to 100 characters'],
    ['a future date of birth', { dateOfBirth: '2999-01-01' }, 'Date of birth'],
    ["another member's photo", { photoPath: photoOf('kofi') }, 'Upload your photo first'],
  ])('refuses %s', async (_case, body, error) => {
    seedProfile({ status: 'pending' });

    expect(await errorOf(await edit(body))).toEqual({
      status: 400,
      error: expect.stringContaining(error),
    });
    expect(firestore.docs.get('members/ama')).toMatchObject({
      status: 'pending',
      updatedAt: created,
    });
  });

  it('needs a profile', async () => {
    expect(await errorOf(await edit({ surname: 'Owusu' }))).toEqual({
      status: 404,
      error: 'Register first',
    });
  });

  it.each(['rejected', 'deactivated'])('refuses a %s member', async (status) => {
    seedProfile({ status });

    expect((await edit({ surname: 'Owusu' })).status).toBe(403);
    expect(firestore.docs.get('members/ama')).toMatchObject({ surname: 'Mensah' });
  });

  it('only changes the caller’s own profile', async () => {
    seedProfile();
    firestore.docs.set('users/kofi', { role: 'member' });

    expect((await edit({ surname: 'Owusu' }, 'kofi')).status).toBe(404);
    expect(firestore.docs.get('members/ama')).toMatchObject({ surname: 'Mensah' });
  });

  it('needs a sign-in', async () => {
    expect((await edit({ surname: 'Owusu' }, null)).status).toBe(401);
  });
});

// Status changes, as approval (NKB-307) and deactivation will make them.
describe('changeProfile', () => {
  function setStatus(status: string) {
    return runTransaction(env, async (tx) => {
      const { profile, listed } = await readMember(tx, 'ama');
      changeProfile(tx, 'ama', profile!, listed, { status } as never);
    });
  }

  it('lists a member when they are approved', async () => {
    seedProfile({ status: 'pending' });

    await setStatus('active');

    expect(firestore.docs.get('directory/ama')).toEqual(entry);
    expect(firestore.commits).toHaveLength(1);
  });

  it.each(['rejected', 'deactivated'])('removes a member who becomes %s', async (status) => {
    seedProfile();

    await setStatus(status);

    expect(firestore.docs.get('members/ama')).toMatchObject({ status });
    expect(firestore.docs.has('directory/ama')).toBe(false);
  });
});
