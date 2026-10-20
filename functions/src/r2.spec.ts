import { describe, expect, it } from 'vitest';

import { connectR2, signDownload, signUpload } from './r2';

const r2 = connectR2({
  accountId: 'acct123',
  bucket: 'nkabom-photos',
  accessKeyId: 'key-id',
  secretAccessKey: 'secret',
});

const key = 'photos/ama/0f8fad5b-d9cb-469f-a165-70867728950e.webp';

describe('signUpload', () => {
  it('signs a five-minute PUT link to the object in the R2 bucket', async () => {
    const url = new URL(await signUpload(r2, key, 'image/webp', 1234));

    expect(url.origin).toBe('https://acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/nkabom-photos/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs the content type and size, so a different file is refused', async () => {
    const url = new URL(await signUpload(r2, key, 'image/webp', 1234));

    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host']),
    );
  });

  it('adds no checksum of an empty body, which would fail every real upload', async () => {
    const url = await signUpload(r2, key, 'image/webp', 1234);

    expect(url).not.toMatch(/checksum/i);
  });
});

describe('signDownload', () => {
  it('signs a ten-minute GET link to the object', async () => {
    const url = new URL(await signDownload(r2, key));

    expect(url.pathname).toBe(`/nkabom-photos/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('connectR2', () => {
  it('uses the endpoint override for local testing', async () => {
    const local = connectR2({
      accountId: '',
      bucket: 'nkabom-photos',
      accessKeyId: 'key-id',
      secretAccessKey: 'secret',
      endpoint: 'http://127.0.0.1:9000',
    });

    expect(new URL(await signDownload(local, key)).origin).toBe('http://127.0.0.1:9000');
  });
});
