import { requireUser, type User } from './auth';
import type { Env } from './env';
import { commit, FirestoreError, getDocument, SERVER_TIME, WriteBatch } from './firestore';
import { USERS } from './model';

/** The signed-in caller with the role from their users record. */
export interface Account extends User {
  /** One of ROLES, as stored. Check it with requireAdmin rather than comparing it here. */
  role: string;
}

/**
 * Every endpoint except the health check calls this first (FR-1.11). It checks the sign-in and
 * reads the caller's users record, so the role is current on every call and a removed admin loses
 * access at once. The first call from a new account creates its record as a member, which is why
 * the app calls GET /v1/me straight after sign-up.
 */
export async function requireAccount(request: Request, env: Env): Promise<Account> {
  const user = await requireUser(request, env);
  return { ...user, role: await userRole(env, user) };
}

async function userRole(env: Env, user: User): Promise<string> {
  const path = `${USERS}/${user.uid}`;
  const record = await getDocument(env, path);
  if (record) {
    return String(record['role']);
  }

  // create, not set: admin accounts (NKB-208) write their own record, which must not be replaced
  // by a member one if their first call races with it.
  const batch = new WriteBatch();
  batch.create(path, { role: 'member', email: user.email, createdAt: SERVER_TIME });
  try {
    await commit(env, batch);
    return 'member';
  } catch (error) {
    if (!(error instanceof FirestoreError && error.status === 'ALREADY_EXISTS')) {
      throw error;
    }
    return String((await getDocument(env, path))?.['role']);
  }
}
