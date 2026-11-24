import type { Env } from './env';
import { runTransaction } from './firestore';
import type { EmailCount } from './model';

// Limits on the emails anyone can ask for: verification links (verification.ts) and password
// reset links (password-reset.ts). Each kind counts in its own collection, one document per
// account and one, _all, for all accounts together.

/** The shortest wait between two emails of one kind to the same account. */
export const RESEND_SECONDS = 60;
/**
 * At most this many emails of one kind per account a day (UTC), so one account cannot use up the
 * shared Gmail account's daily allowance (email.ts).
 */
export const MAX_EMAILS_PER_DAY = 5;
/**
 * At most this many emails of one kind a day (UTC) across all accounts. Accounts are free to
 * create, so without it a run of scripted requests could use up the shared Gmail allowance and
 * stop approval emails. Well above real use for a community of about 1,000.
 */
export const MAX_EMAILS_PER_DAY_IN_ALL = 100;

// Firebase user IDs are only letters and digits, so this ID never clashes with one.
const ALL_ACCOUNTS = '_all';

/** Why an email may not be sent: too soon after the last, or a daily limit was reached. */
export type EmailRefusal = 'tooSoon' | 'accountLimit' | 'allLimit';

export type CountedEmail =
  | { refused: EmailRefusal }
  /** Counted. Call uncount if the email then fails to send, so it does not count. */
  | { refused: null; uncount: () => Promise<void> };

/**
 * Checks the limits for one more email to the account, and counts it if allowed. Checked and
 * counted in one transaction before sending, so requests sent at the same moment cannot all get
 * past the limits.
 */
export async function countEmail(
  env: Env,
  collection: string,
  uid: string,
  now: number,
): Promise<CountedEmail> {
  const path = `${collection}/${uid}`;
  const allPath = `${collection}/${ALL_ACCOUNTS}`;
  const day = new Date(now).toISOString().slice(0, 10);

  const counted = await runTransaction(env, async (tx) => {
    const [mine, all] = (await tx.getAll(path, allPath)) as (EmailCount | null)[];
    if (mine && now - mine.lastSentAt < RESEND_SECONDS * 1000) {
      return { refused: 'tooSoon' as const };
    }
    const count = mine?.day === day ? mine.count : 0;
    if (count >= MAX_EMAILS_PER_DAY) {
      return { refused: 'accountLimit' as const };
    }
    const total = all?.day === day ? all.count : 0;
    if (total >= MAX_EMAILS_PER_DAY_IN_ALL) {
      return { refused: 'allLimit' as const };
    }
    tx.set(path, { lastSentAt: now, day, count: count + 1 } satisfies EmailCount);
    tx.set(allPath, { lastSentAt: now, day, count: total + 1 } satisfies EmailCount);
    return { refused: null, previous: mine };
  });
  if (counted.refused) {
    return { refused: counted.refused };
  }

  // Takes back the count for an email that failed to send.
  const uncount = () =>
    runTransaction(env, async (tx) => {
      const [mine, all] = (await tx.getAll(path, allPath)) as (EmailCount | null)[];
      if (mine?.day === day) {
        tx.set(path, {
          lastSentAt: counted.previous?.lastSentAt ?? 0,
          day,
          count: Math.max(0, mine.count - 1),
        } satisfies EmailCount);
      }
      if (all?.day === day) {
        tx.set(allPath, { ...all, count: Math.max(0, all.count - 1) });
      }
    });
  return { refused: null, uncount };
}
