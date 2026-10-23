import { requireUser } from './auth';
import { preflight, withCors } from './cors';
import type { Env } from './env';
import { getDocument } from './firestore';
import { HttpError, json } from './http';
import { getPhotoDownloadUrl, getPhotoUploadUrl, servePhoto } from './photos';

// The app's API (NKB-114). Writes with side effects go through here; the app reads Firestore
// directly. Each endpoint except /health and the signed photo links starts with requireUser.
export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return preflight(request, env);
    }
    return withCors(await handle(request, env), request, env);
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env): Promise<Response> {
  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    console.error('Request failed', {
      method: request.method,
      path: new URL(request.url).pathname,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    return json({ error: 'Something went wrong' }, 500);
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/photos/')) {
    return servePhoto(request, env);
  }
  switch (pathname) {
    case '/health':
      allow(request, 'GET');
      return json({ ok: true });
    case '/v1/me': {
      // Test endpoint: checks the sign-in and reads the caller's users record.
      allow(request, 'GET');
      const user = await requireUser(request, env);
      const record = await getDocument(env, `users/${user.uid}`);
      return json({ uid: user.uid, role: record?.['role'] ?? null });
    }
    case '/v1/photos/upload-url':
      allow(request, 'POST');
      return getPhotoUploadUrl(request, env, await requireUser(request, env));
    case '/v1/photos/download-url':
      allow(request, 'POST');
      return getPhotoDownloadUrl(request, env, await requireUser(request, env));
    default:
      throw new HttpError(404, 'Not found');
  }
}

function allow(request: Request, method: string): void {
  if (request.method !== method) {
    throw new HttpError(405, 'Method not allowed');
  }
}
