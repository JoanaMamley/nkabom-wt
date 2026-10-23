import { SERVER_TIME, type WriteBatch } from './firestore';
import { AUDIT_LOG, type AuditAction, type AuditDetails, type AuditTarget } from './model';
import type { Account } from './users';

/**
 * Records an admin action in the audit log (FR-8.3), as part of the transaction or batch that
 * makes the change, so the action and its entry are saved together or not at all:
 *
 *   await runTransaction(env, async (tx) => {
 *     ...
 *     recordAudit(tx, admin, 'registration.approve', { type: 'member', id: uid });
 *   });
 *
 * Entries can only be added: the rules deny every client write and this is the only code that
 * writes to the collection, through create().
 */
export function recordAudit(
  tx: WriteBatch,
  actor: Account,
  action: AuditAction,
  target: AuditTarget | null,
  details?: AuditDetails,
): void {
  tx.create(`${AUDIT_LOG}/${autoId()}`, {
    actor: { uid: actor.uid, name: actor.name, email: actor.email },
    action,
    target,
    details: details ?? null,
    at: SERVER_TIME,
  });
}

const ID_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// 20 random characters, like the IDs Firestore's SDKs make for add(). 62 is not a factor of 256,
// so a few characters are slightly more likely; that does not matter for uniqueness.
function autoId(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(20)),
    (byte) => ID_CHARACTERS[byte % ID_CHARACTERS.length],
  ).join('');
}
