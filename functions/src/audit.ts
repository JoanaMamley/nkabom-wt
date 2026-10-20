import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { AUDIT_LOG, type AuditAction, type AuditDetails, type AuditTarget } from './model';

/** The caller, as in request.auth of a callable function. */
export type Caller = Pick<NonNullable<CallableRequest['auth']>, 'uid' | 'token'> | undefined;

/**
 * Records an admin action in the audit log (FR-8.3). Pass the caller's auth from the function
 * request, for example:
 *
 *   await recordAudit(request.auth, 'registration.approve', { type: 'member', id: uid });
 *
 * Entries can only be added: the rules deny every client write and this is the only code that
 * writes to the collection, through create().
 */
export async function recordAudit(
  actor: Caller,
  action: AuditAction,
  target: AuditTarget | null,
  details?: AuditDetails,
): Promise<void> {
  // Every recorded action needs someone to answer for it.
  if (!actor) {
    throw new Error(`Audit entry for ${action} has no signed-in actor`);
  }

  await getFirestore()
    .collection(AUDIT_LOG)
    .doc()
    .create({
      actor: {
        uid: actor.uid,
        name: actor.token.name ?? null,
        email: actor.token.email ?? null,
      },
      action,
      target,
      details: details ?? null,
      at: FieldValue.serverTimestamp(),
    });
}
