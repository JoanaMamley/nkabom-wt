import type { CallableRequest } from 'firebase-functions/v2/https';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPhotoDownloadUrl, getPhotoUploadUrl } from './photos';

const env = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'nkabom-photos',
  R2_ENDPOINT: '',
};

function call<T>(
  fn: { run: (request: CallableRequest) => T },
  data: unknown,
  uid: string | null = 'ama',
): T {
  return fn.run({ data, auth: uid ? { uid, token: {} } : undefined } as CallableRequest);
}

const amaPhoto = 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp';

beforeEach(() => Object.assign(process.env, env));
afterEach(() => Object.keys(env).forEach((name) => delete process.env[name]));

describe('getPhotoUploadUrl', () => {
  it("returns a signed upload link and a new path in the caller's folder", async () => {
    const result = await call(getPhotoUploadUrl, { contentType: 'image/webp', size: 1234 });

    expect(result.path).toMatch(/^photos\/ama\/[0-9a-f-]{36}\.webp$/);
    expect(new URL(result.url).pathname).toBe(`/nkabom-photos/${result.path}`);
    expect(result.expiresIn).toBe(300);
  });

  it('gives each upload a new path', async () => {
    const first = await call(getPhotoUploadUrl, { contentType: 'image/png', size: 1 });
    const second = await call(getPhotoUploadUrl, { contentType: 'image/png', size: 1 });

    expect(first.path).not.toBe(second.path);
  });

  it('stores JPG files under .jpg', async () => {
    const result = await call(getPhotoUploadUrl, { contentType: 'image/jpeg', size: 1 });

    expect(result.path).toMatch(/\.jpg$/);
  });

  it('requires sign-in', async () => {
    await expect(
      call(getPhotoUploadUrl, { contentType: 'image/webp', size: 1 }, null),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it.each([
    ['a GIF', { contentType: 'image/gif', size: 1 }],
    ['a missing type', { size: 1 }],
    ['an inherited property name as the type', { contentType: 'toString', size: 1 }],
    ['an empty file', { contentType: 'image/webp', size: 0 }],
    ['a file over 5 MB', { contentType: 'image/webp', size: 5 * 1024 * 1024 + 1 }],
    ['a fractional size', { contentType: 'image/webp', size: 1.5 }],
    ['a size as text', { contentType: 'image/webp', size: '1' }],
    ['no data', null],
  ])('refuses %s', async (_case, data) => {
    await expect(call(getPhotoUploadUrl, data)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('accepts exactly 5 MB', async () => {
    await expect(
      call(getPhotoUploadUrl, { contentType: 'image/webp', size: 5 * 1024 * 1024 }),
    ).resolves.toBeDefined();
  });

  it('says so when R2 is not configured', async () => {
    delete process.env['R2_SECRET_ACCESS_KEY'];

    await expect(
      call(getPhotoUploadUrl, { contentType: 'image/webp', size: 1 }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('getPhotoDownloadUrl', () => {
  it("returns a signed link to the caller's own photo", async () => {
    const result = await call(getPhotoDownloadUrl, { path: amaPhoto });

    expect(new URL(result.url).pathname).toBe(`/nkabom-photos/${amaPhoto}`);
    expect(result.expiresIn).toBe(600);
  });

  it("refuses another member's photo", async () => {
    await expect(call(getPhotoDownloadUrl, { path: amaPhoto }, 'kofi')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('requires sign-in', async () => {
    await expect(call(getPhotoDownloadUrl, { path: amaPhoto }, null)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it.each([
    ['a path outside photos/', 'secrets/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp'],
    ['a path that climbs out of the folder', 'photos/ama/../kofi/0f8fad5b-d9cb-469f.webp'],
    ['another file type', 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.svg'],
    ['a URL', `https://example.com/${amaPhoto}`],
    ['a number', 42],
  ])('refuses %s', async (_case, path) => {
    await expect(call(getPhotoDownloadUrl, { path })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});
