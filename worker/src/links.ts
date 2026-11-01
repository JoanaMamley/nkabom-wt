import { base64url } from 'jose';

import type { Env } from './env';
import { HttpError } from './http';

// Signed links: photo links (photos.ts) and email verification links (verification.ts). Each kind
// signs different parts, starting with its own first part (an HTTP method for photos,
// 'verify-email' for verification), so a signature for one is never valid for the other.

/** HMAC-SHA256 over the link's parts, one per line, keyed by PHOTO_LINK_KEY. */
export async function signLink(env: Env, parts: string[]): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await linkKey(env), encode(parts));
  return base64url.encode(new Uint8Array(signature));
}

export async function verifyLink(env: Env, parts: string[], sig: string): Promise<boolean> {
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
    throw new HttpError(503, 'Signed links are not configured');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.PHOTO_LINK_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
