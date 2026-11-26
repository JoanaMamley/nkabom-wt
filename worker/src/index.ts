import {
  createAdmin,
  deactivateAdmin,
  deleteAdmin,
  listAdmins,
  reactivateAdmin,
  setAdminRole,
} from './admins';
import { preflight, withCors } from './cors';
import type { Env } from './env';
import { sendEmail } from './email';
import { HttpError, json } from './http';
import { type JobMessage, queueScheduledTasks, runJobMessages } from './jobs';
import { editProfile, register } from './members';
import { resetPassword, sendPasswordResetEmail, setFirstPassword } from './password-reset';
import { getPhotoDownloadUrl, getPhotoUploadUrl, servePhoto } from './photos';
import { requireAdmin } from './roles';
import { requireUser } from './auth';
import { type Account, requireAccount } from './users';
import { confirmVerification, sendVerificationEmail } from './verification';

// The app's API (NKB-114). Writes with side effects go through here; the app reads Firestore
// directly. Each endpoint starts with requireAccount, except /health, the signed photo links, the
// email verification endpoints (verification.ts) and the password reset ones (password-reset.ts).
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
  const admin = /^\/v1\/admins\/([^/]+)(?:\/(deactivate|reactivate))?$/.exec(pathname);
  if (admin) {
    // User IDs are letters and digits only (FIREBASE_UID), so there is nothing to decode.
    return manageAdmin(request, env, admin[1], admin[2]);
  }
  switch (pathname) {
    case '/health':
      allow(request, 'GET');
      return json({ ok: true });
    case '/v1/me': {
      // The app calls this after every sign-in, which also creates a new account's users record,
      // and while it is in use, which keeps the sign-in from expiring (sessions.ts).
      allow(request, 'GET');
      const { uid, role, session } = await requireAccount(request, env);
      return json({ uid, role, session });
    }
    case '/v1/email/verification':
      // Before the address is verified, so it checks the sign-in only (verification.ts).
      allow(request, 'POST');
      return sendVerificationEmail(env, await requireUser(request, env));
    case '/v1/email/verify':
      // From the emailed link, which is the permission; no sign-in.
      allow(request, 'POST');
      return confirmVerification(request, env);
    case '/v1/password/reset-link':
      // For someone who cannot log in; no sign-in.
      allow(request, 'POST');
      return sendPasswordResetEmail(request, env);
    case '/v1/password/reset':
      // From the emailed link, which is the permission; no sign-in.
      allow(request, 'POST');
      return resetPassword(request, env);
    case '/v1/password/set':
      // From the link a new admin is emailed (admins.ts), which is the permission; no sign-in.
      allow(request, 'POST');
      return setFirstPassword(request, env);
    case '/v1/admins':
      // FR-1.6: a Primary Admin lists the admin accounts and creates them.
      if (request.method === 'GET') {
        return listAdmins(env, await requireAccount(request, env));
      }
      allow(request, 'POST');
      return createAdmin(request, env, await requireAccount(request, env));
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

// FR-1.6, FR-1.7: a Primary Admin changes another admin's role (PATCH), deactivates or
// reactivates them (POST to .../deactivate or .../reactivate) or deletes them (DELETE), at
// /v1/admins/{uid}.
async function manageAdmin(
  request: Request,
  env: Env,
  uid: string,
  action: string | undefined,
): Promise<Response> {
  if (action) {
    allow(request, 'POST');
    const account = await requireAccount(request, env);
    return action === 'deactivate'
      ? deactivateAdmin(env, account, uid)
      : reactivateAdmin(env, account, uid);
  }
  if (request.method === 'DELETE') {
    return deleteAdmin(env, await requireAccount(request, env), uid);
  }
  allow(request, 'PATCH');
  return setAdminRole(request, env, await requireAccount(request, env), uid);
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
