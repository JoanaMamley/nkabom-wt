import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Signed links to the private Cloudflare R2 photo bucket (FR-8.2). R2 speaks the S3 API, so the
// AWS SDK signs the links locally; no request reaches R2 until the browser uses one.

export const UPLOAD_URL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_SECONDS = 10 * 60;

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Overrides the R2 endpoint, for an S3-compatible server in local testing. */
  endpoint?: string;
}

export interface R2 {
  client: S3Client;
  bucket: string;
}

export function connectR2(config: R2Config): R2 {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // By default the SDK adds a checksum of the (empty) body to signed upload links, which makes
    // every real upload fail the check.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return { client, bucket: config.bucket };
}

/**
 * A PUT link for one object. Content type and length are signed, so the browser must upload a
 * file of exactly the type and size it asked for.
 */
export function signUpload(
  r2: R2,
  key: string,
  contentType: string,
  size: number,
): Promise<string> {
  return getSignedUrl(
    r2.client,
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: UPLOAD_URL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

/** A GET link for one object. */
export function signDownload(r2: R2, key: string): Promise<string> {
  return getSignedUrl(r2.client, new GetObjectCommand({ Bucket: r2.bucket, Key: key }), {
    expiresIn: DOWNLOAD_URL_SECONDS,
  });
}
