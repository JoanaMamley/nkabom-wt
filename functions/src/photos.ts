import { randomUUID } from 'node:crypto';
import { defineSecret, defineString } from 'firebase-functions/params';
import { type CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

import { MAX_PHOTO_BYTES, PHOTO_TYPES, type PhotoType } from './model';
import {
  connectR2,
  DOWNLOAD_URL_SECONDS,
  signDownload,
  signUpload,
  UPLOAD_URL_SECONDS,
} from './r2';

// Set with firebase functions:secrets:set (see the README), as one JSON secret rather than three
// so Secret Manager stays within its free versions. R2_ENDPOINT is for local testing only.
const r2Credentials = defineSecret('R2_CREDENTIALS');
const r2Bucket = defineString('R2_BUCKET', { default: 'nkabom-photos' });
const r2Endpoint = defineString('R2_ENDPOINT', { default: '' });

const secrets = [r2Credentials];

interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The R2 keys from R2_CREDENTIALS, or null when it is missing or not the expected JSON. */
export function parseR2Credentials(value: string): R2Credentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const { accountId, accessKeyId, secretAccessKey } = (parsed ?? {}) as Record<string, unknown>;
  if (
    typeof accountId !== 'string' ||
    typeof accessKeyId !== 'string' ||
    typeof secretAccessKey !== 'string' ||
    !accountId ||
    !accessKeyId ||
    !secretAccessKey
  ) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey };
}

// photos/{uid}/{uuid}.{ext}. firestore.rules checks a profile's photoPath against the same shape.
const PHOTO_PATH = /^photos\/([A-Za-z0-9]+)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

function r2() {
  const credentials = parseR2Credentials(r2Credentials.value());
  if (!credentials) {
    throw new HttpsError('failed-precondition', 'Photo storage is not configured');
  }

  return connectR2({
    ...credentials,
    bucket: r2Bucket.value(),
    endpoint: r2Endpoint.value(),
  });
}

function signedInUid(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to use photos');
  }
  return request.auth.uid;
}

/**
 * Returns a short-lived link for uploading the caller's photo, and the path to save in their
 * profile. The browser must PUT a file of exactly the type and size it declared.
 */
export const getPhotoUploadUrl = onCall({ secrets }, async (request) => {
  const uid = signedInUid(request);
  const { contentType, size } = (request.data ?? {}) as { contentType?: unknown; size?: unknown };

  if (typeof contentType !== 'string' || !Object.hasOwn(PHOTO_TYPES, contentType)) {
    throw new HttpsError('invalid-argument', 'Photos must be JPG, PNG or WebP');
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) {
    throw new HttpsError('invalid-argument', 'Photos must be 5 MB or smaller');
  }

  const path = `photos/${uid}/${randomUUID()}.${PHOTO_TYPES[contentType as PhotoType]}`;
  const url = await signUpload(r2(), path, contentType, size);

  return { url, path, expiresIn: UPLOAD_URL_SECONDS };
});

/** Returns a short-lived link for viewing a photo the caller may see. */
export const getPhotoDownloadUrl = onCall({ secrets }, async (request) => {
  const uid = signedInUid(request);
  const { path } = (request.data ?? {}) as { path?: unknown };

  const owner = typeof path === 'string' ? PHOTO_PATH.exec(path)?.[1] : undefined;
  if (!owner) {
    throw new HttpsError('invalid-argument', 'Not a photo path');
  }
  // Members see only their own photo for now. Admins (NKB-208) and the directory (NKB-601) add
  // their own access checks here.
  if (owner !== uid) {
    throw new HttpsError('permission-denied', 'You cannot view this photo');
  }

  const url = await signDownload(r2(), path as string);

  return { url, expiresIn: DOWNLOAD_URL_SECONDS };
});
