import { base64url } from 'jose';

import type { User } from './auth';
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { MAX_PHOTO_BYTES, PHOTO_TYPES, type PhotoType } from './model';

// Member photos in the private PHOTOS Workers KV namespace (FR-2.3, FR-8.2). Nothing reads KV
// directly: the browser asks for a short-lived link signed by the Worker, then uploads or
// downloads through the Worker with it.

export const UPLOAD_URL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_SECONDS = 10 * 60;

// photos/{uid}/{uuid}.{ext}, also the KV key.
const PHOTO_PATH = /^photos\/([A-Za-z0-9]+)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** The user ID whose folder a photo path is in, or null if it is not a photo path. */
export function photoOwner(path: unknown): string | null {
  return typeof path === 'string' ? (PHOTO_PATH.exec(path)?.[1] ?? null) : null;
}

/** Whether a photo has been uploaded to this path. */
export async function photoExists(env: Env, path: string): Promise<boolean> {
  // A stream, cancelled at once, so the photo itself is not read.
  const photo = await env.PHOTOS.get(path, 'stream');
  await photo?.cancel();
  return photo !== null;
}

/**
 * POST /v1/photos/upload-url with { contentType, size }: a 5-minute link for uploading the
 * caller's photo, and the path to save in their profile. The browser must PUT a file of exactly
 * the type and size it declared.
 */
export async function getPhotoUploadUrl(request: Request, env: Env, user: User): Promise<Response> {
  const { contentType, size } = await readJson(request);

  if (typeof contentType !== 'string' || !Object.hasOwn(PHOTO_TYPES, contentType)) {
    throw new HttpError(400, 'Photos must be JPG, PNG or WebP');
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) {
    throw new HttpError(400, 'Photos must be 5 MB or smaller');
  }

  const path = `photos/${user.uid}/${crypto.randomUUID()}.${PHOTO_TYPES[contentType as PhotoType]}`;
  const url = await signUpload(env, new URL(request.url).origin, path, contentType, size);

  return json({ url, path, expiresIn: UPLOAD_URL_SECONDS });
}

/** POST /v1/photos/download-url with { path }: a 10-minute link for viewing a photo. */
export async function getPhotoDownloadUrl(
  request: Request,
  env: Env,
  user: User,
): Promise<Response> {
  const { path } = await readJson(request);

  const owner = photoOwner(path);
  if (!owner) {
    throw new HttpError(400, 'Not a photo path');
  }
  // Members see only their own photo for now. Admins (NKB-208) and the directory (NKB-601) add
  // their own access checks here.
  if (owner !== user.uid) {
    throw new HttpError(403, 'You cannot view this photo');
  }

  const url = await signDownload(env, new URL(request.url).origin, path as string);

  return json({ url, expiresIn: DOWNLOAD_URL_SECONDS });
}

/** A PUT link for one photo. The type and size are signed, so they cannot be changed. */
export async function signUpload(
  env: Env,
  origin: string,
  path: string,
  contentType: string,
  size: number,
  now = Date.now(),
): Promise<string> {
  const expires = String(Math.floor(now / 1000) + UPLOAD_URL_SECONDS);
  const sig = await sign(env, ['PUT', path, expires, contentType, String(size)]);
  const query = new URLSearchParams({ expires, type: contentType, size: String(size), sig });
  return `${origin}/${path}?${query}`;
}

/** A GET link for one photo. */
export async function signDownload(
  env: Env,
  origin: string,
  path: string,
  now = Date.now(),
): Promise<string> {
  const expires = String(Math.floor(now / 1000) + DOWNLOAD_URL_SECONDS);
  const sig = await sign(env, ['GET', path, expires]);
  return `${origin}/${path}?${new URLSearchParams({ expires, sig })}`;
}

/** GET or PUT /photos/...: uses a signed link. No sign-in is needed; the link is the permission. */
export async function servePhoto(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(1);
  if (!PHOTO_PATH.test(path)) {
    throw new HttpError(404, 'Not found');
  }
  if (request.method !== 'GET' && request.method !== 'PUT') {
    throw new HttpError(405, 'Method not allowed');
  }

  const query = url.searchParams;
  const expires = query.get('expires') ?? '';
  const type = query.get('type') ?? '';
  const size = query.get('size') ?? '';
  const parts =
    request.method === 'PUT' ? ['PUT', path, expires, type, size] : ['GET', path, expires];
  if (!(await verify(env, parts, query.get('sig') ?? ''))) {
    throw new HttpError(403, 'Invalid photo link');
  }
  const remaining = Number(expires) - Math.floor(Date.now() / 1000);
  if (!(remaining > 0)) {
    throw new HttpError(403, 'Photo link has expired');
  }

  if (request.method === 'GET') {
    const { value, metadata } = await env.PHOTOS.getWithMetadata<PhotoMetadata>(path, 'stream');
    if (!value || !metadata) {
      throw new HttpError(404, 'Photo not found');
    }
    return new Response(value, {
      headers: {
        'Content-Type': metadata.contentType,
        'Cache-Control': `private, max-age=${remaining}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // The signature covers type and size, so these compare the upload with what was declared.
  if (request.headers.get('Content-Type') !== type) {
    throw new HttpError(400, `The photo must be uploaded as ${type}`);
  }
  // Checked before reading, so an oversized upload is refused without buffering it.
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null && declaredLength !== size) {
    throw new HttpError(400, `The photo must be exactly ${size} bytes`);
  }
  const body = await request.arrayBuffer();
  if (String(body.byteLength) !== size) {
    throw new HttpError(400, `The photo must be exactly ${size} bytes`);
  }
  await env.PHOTOS.put(path, body, { metadata: { contentType: type } satisfies PhotoMetadata });
  return new Response(null, { status: 204 });
}

interface PhotoMetadata {
  contentType: string;
}

// HMAC-SHA256 over the link's parts, one per line, keyed by PHOTO_LINK_KEY.
async function sign(env: Env, parts: string[]): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await linkKey(env), encode(parts));
  return base64url.encode(new Uint8Array(signature));
}

async function verify(env: Env, parts: string[], sig: string): Promise<boolean> {
  let signature: Uint8Array;
  try {
    signature = base64url.decode(sig);
  } catch {
    return false;
  }
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', await linkKey(env), signature, encode(parts));
}

function encode(parts: string[]): Uint8Array {
  return new TextEncoder().encode(parts.join('\n'));
}

function linkKey(env: Env): Promise<CryptoKey> {
  if (!env.PHOTO_LINK_KEY) {
    throw new HttpError(503, 'Photo storage is not configured');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.PHOTO_LINK_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
