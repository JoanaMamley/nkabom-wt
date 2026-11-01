import { env as bindings } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import worker from './index';
import { signDownload, signUpload } from './photos';
import { claims, emulatorEnv, mockEmulators, unsignedToken } from './test-helpers';

const ORIGIN = 'https://api.test';
const amaPhoto = 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp';

// The local PHOTOS namespace from wrangler.jsonc.
const { PHOTOS } = bindings as unknown as Env;
const env = emulatorEnv({ PHOTOS, PHOTO_LINK_KEY: 'test-photo-link-key' });

beforeEach(() => {
  // The Auth emulator knows every user these tests sign in as, and Firestore has their records.
  mockEmulators();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function call(url: string, init: RequestInit = {}, callEnv = env) {
  const request = new Request(url.startsWith('/') ? `${ORIGIN}${url}` : url, init) as Request<
    unknown,
    IncomingRequestCfProperties
  >;
  return worker.fetch(request, callEnv);
}

function post(path: string, body: unknown, uid: string | null = 'ama', callEnv = env) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (uid) {
    headers['Authorization'] = `Bearer ${unsignedToken(claims('demo-nkabom', uid))}`;
  }
  return call(path, { method: 'POST', headers, body: JSON.stringify(body) }, callEnv);
}

async function uploadUrl(contentType: string, size: number) {
  const response = await post('/v1/photos/upload-url', { contentType, size });
  return (await response.json()) as { url: string; path: string; expiresIn: number };
}

function put(url: string, body: Uint8Array, contentType: string) {
  return call(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
}

describe('POST /v1/photos/upload-url', () => {
  it("returns a signed upload link and a new path in the caller's folder", async () => {
    const result = await uploadUrl('image/webp', 1234);

    expect(result.path).toMatch(/^photos\/ama\/[0-9a-f-]{36}\.webp$/);
    expect(new URL(result.url).origin).toBe(ORIGIN);
    expect(new URL(result.url).pathname).toBe(`/${result.path}`);
    expect(result.expiresIn).toBe(300);
  });

  it('gives each upload a new path', async () => {
    const first = await uploadUrl('image/png', 1);
    const second = await uploadUrl('image/png', 1);

    expect(first.path).not.toBe(second.path);
  });

  it('stores JPG files under .jpg', async () => {
    const result = await uploadUrl('image/jpeg', 1);

    expect(result.path).toMatch(/\.jpg$/);
  });

  it('requires sign-in', async () => {
    const response = await post(
      '/v1/photos/upload-url',
      { contentType: 'image/webp', size: 1 },
      null,
    );

    expect(response.status).toBe(401);
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
    const response = await post('/v1/photos/upload-url', data);

    expect(response.status).toBe(400);
  });

  it('accepts exactly 5 MB', async () => {
    const response = await post('/v1/photos/upload-url', {
      contentType: 'image/webp',
      size: 5 * 1024 * 1024,
    });

    expect(response.status).toBe(200);
  });

  it('says so when photo links are not configured', async () => {
    const response = await post(
      '/v1/photos/upload-url',
      { contentType: 'image/webp', size: 1 },
      'ama',
      { ...env, PHOTO_LINK_KEY: undefined },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Signed links are not configured' });
  });
});

describe('POST /v1/photos/download-url', () => {
  it("returns a signed link to the caller's own photo", async () => {
    const response = await post('/v1/photos/download-url', { path: amaPhoto });
    const result = (await response.json()) as { url: string; expiresIn: number };

    expect(new URL(result.url).pathname).toBe(`/${amaPhoto}`);
    expect(result.expiresIn).toBe(600);
  });

  it("refuses another member's photo", async () => {
    const response = await post('/v1/photos/download-url', { path: amaPhoto }, 'kofi');

    expect(response.status).toBe(403);
  });

  it('requires sign-in', async () => {
    const response = await post('/v1/photos/download-url', { path: amaPhoto }, null);

    expect(response.status).toBe(401);
  });

  it.each([
    ['a path outside photos/', 'secrets/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp'],
    ['a path that climbs out of the folder', 'photos/ama/../kofi/0f8fad5b-d9cb-469f.webp'],
    ['another file type', 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.svg'],
    ['a URL', `https://example.com/${amaPhoto}`],
    ['a number', 42],
  ])('refuses %s', async (_case, path) => {
    const response = await post('/v1/photos/download-url', { path });

    expect(response.status).toBe(400);
  });
});

describe('signed photo links', () => {
  const photo = new Uint8Array([1, 2, 3, 4, 5]);

  async function uploaded() {
    const { url, path } = await uploadUrl('image/webp', photo.length);
    expect((await put(url, photo, 'image/webp')).status).toBe(204);
    return path;
  }

  it('uploads with the link and downloads with a download link', async () => {
    const path = await uploaded();
    const download = await signDownload(env, ORIGIN, path);

    const response = await call(download);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(photo);
  });

  it('refuses an upload without a link', async () => {
    const response = await put(`/${amaPhoto}`, photo, 'image/webp');

    expect(response.status).toBe(403);
    expect(await PHOTOS.get(amaPhoto)).toBeNull();
  });

  it('refuses a download without a link', async () => {
    const path = await uploaded();

    const response = await call(`/${path}`);

    expect(response.status).toBe(403);
  });

  it('refuses a link whose path was changed', async () => {
    const { url } = await uploadUrl('image/webp', photo.length);
    const changed = url.replace(
      /photos\/ama\/[0-9a-f-]{36}/,
      'photos/kofi/0f8fad5b-d9cb-469f-a165-70867728950e',
    );

    const response = await put(changed, photo, 'image/webp');

    expect(response.status).toBe(403);
  });

  it('refuses a link whose expiry was pushed back', async () => {
    const { url } = await uploadUrl('image/webp', photo.length);
    const later = new URL(url);
    later.searchParams.set('expires', String(Number(later.searchParams.get('expires')) + 3600));

    const response = await put(later.toString(), photo, 'image/webp');

    expect(response.status).toBe(403);
  });

  it('refuses a link signed with another key', async () => {
    const forged = await signUpload(
      { ...env, PHOTO_LINK_KEY: 'guessed-key' },
      ORIGIN,
      amaPhoto,
      'image/webp',
      photo.length,
    );

    const response = await put(forged, photo, 'image/webp');

    expect(response.status).toBe(403);
  });

  it('refuses an expired upload link', async () => {
    const expired = await signUpload(
      env,
      ORIGIN,
      amaPhoto,
      'image/webp',
      photo.length,
      Date.now() - 301_000,
    );

    const response = await put(expired, photo, 'image/webp');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Photo link has expired' });
  });

  it('refuses an expired download link', async () => {
    const path = await uploaded();
    const expired = await signDownload(env, ORIGIN, path, Date.now() - 601_000);

    const response = await call(expired);

    expect(response.status).toBe(403);
  });

  it('refuses to download with an upload link', async () => {
    const { url } = await uploadUrl('image/webp', photo.length);
    await put(url, photo, 'image/webp');

    const response = await call(url);

    expect(response.status).toBe(403);
  });

  it('refuses a file of another type than declared', async () => {
    const { url } = await uploadUrl('image/webp', photo.length);

    const response = await put(url, photo, 'image/svg+xml');

    expect(response.status).toBe(400);
  });

  it('refuses a type changed in the link', async () => {
    const { url } = await uploadUrl('image/webp', photo.length);
    const changed = new URL(url);
    changed.searchParams.set('type', 'image/svg+xml');

    const response = await put(changed.toString(), photo, 'image/svg+xml');

    expect(response.status).toBe(403);
  });

  it('refuses a file larger than declared', async () => {
    const { url, path } = await uploadUrl('image/webp', photo.length);

    const response = await put(url, new Uint8Array(photo.length + 1), 'image/webp');

    expect(response.status).toBe(400);
    expect(await PHOTOS.get(path)).toBeNull();
  });

  it('refuses a file smaller than declared', async () => {
    const { url } = await uploadUrl('image/webp', photo.length);

    const response = await put(url, photo.slice(1), 'image/webp');

    expect(response.status).toBe(400);
  });

  it('answers 404 for a photo that was never uploaded', async () => {
    const download = await signDownload(env, ORIGIN, amaPhoto);

    const response = await call(download);

    expect(response.status).toBe(404);
  });

  it('answers 404 for paths that are not photos', async () => {
    const response = await call('/photos/ama/notes.txt');

    expect(response.status).toBe(404);
  });
});
