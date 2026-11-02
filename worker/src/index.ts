import { preflight, withCors } from './cors';
import type { Env } from './env';
import { sendEmail } from './email';
import { HttpError, json } from './http';
import { type JobMessage, queueScheduledTasks, runJobMessages } from './jobs';
import { editProfile, register } from './members';
import { getPhotoDownloadUrl, getPhotoUploadUrl, servePhoto } from './photos';
import { requireAdmin } from './roles';
import { requireUser } from './auth';
import { type Account, requireAccount } from './users';
import { confirmVerification, sendVerificationEmail } from './verification';

// The app's API (NKB-114). Writes with side effects go through here; the app reads Firestore
// directly. Each endpoint starts with requireAccount, except /health, the signed photo links and
// the email verification endpoints (verification.ts).
export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return preflight(request, env);
    }
    return withCors(await handle(request, env), request, env);
  },
  // Cron Triggers and the JOBS queue (NKB-118).
  scheduled: (controller, env) => queueScheduledTasks(controller, env),
  queue: (batch, env) => runJobMessages(batch, env),
} satisfies ExportedHandler<Env, JobMessage>;

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
      // The app calls this after every sign-in, which also creates a new account's users record.
      allow(request, 'GET');
      const { uid, role } = await requireAccount(request, env);
      return json({ uid, role });
    }
    case '/v1/email/verification':
      // Before the address is verified, so it checks the sign-in only (verification.ts).
      allow(request, 'POST');
      return sendVerificationEmail(env, await requireUser(request, env));
    case '/v1/email/verify':
      // From the emailed link, which is the permission; no sign-in.
      allow(request, 'POST');
      return confirmVerification(request, env);
    case '/v1/registration':
      allow(request, 'POST');
      return register(request, env, await requireAccount(request, env));
    case '/v1/profile':
      allow(request, 'PATCH');
      return editProfile(request, env, await requireAccount(request, env));
    case '/v1/photos/upload-url':
      allow(request, 'POST');
      return getPhotoUploadUrl(request, env, await requireAccount(request, env));
    case '/v1/photos/download-url':
      allow(request, 'POST');
      return getPhotoDownloadUrl(request, env, await requireAccount(request, env));
    case '/v1/email/test':
      allow(request, 'POST');
      return sendTestEmail(env, await requireAccount(request, env));
    default:
      throw new HttpError(404, 'Not found');
  }
}

// FR-4.14: an admin sends themselves a test email, which also checks the email set-up.
async function sendTestEmail(env: Env, user: Account): Promise<Response> {
  requireAdmin(user);
  if (!user.email) {
    throw new HttpError(400, 'Your account has no email address');
  }
  try {
    await sendEmail(env, { email: user.email }, 'testNotification', {
      name: 'there',
      settingsUrl: `${env.APP_URL}/settings`,
    });
  } catch {
    // sendEmail has logged why.
    throw new HttpError(502, 'The email could not be sent');
  }
  return json({ sentTo: user.email });
}

function allow(request: Request, method: string): void {
  if (request.method !== method) {
    throw new HttpError(405, 'Method not allowed');
  }
}
