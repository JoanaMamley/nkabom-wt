# Shared project accounts

Everything Nkabom runs on belongs to one shared project Google account (FR-8.7), not to any one person. This page says what that account owns, how signing in is protected, and where the recovery details are kept. Handing the account over to new executives is covered in the rest of the handbook (NKB-708).

Never put a password, backup code or API key on this page or anywhere in the repo. This page says only where they are kept.

## What the account owns

| Account            | Signed in with                    | Owns                                                                                     |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------- |
| Google             | Its own address and password      | Firebase projects `nkabom-staging` and `nkabom-prod`, their Google Cloud projects, the billing account, budget emails, and from NKB-501 the calendar service account |
| Cloudflare         | The Google account's address      | R2 buckets `nkabom-photos` (production) and `nkabom-photos-staging`, and their API tokens |
| Brevo              | The Google account's address      | The sending domain and one API key per Firebase project                                  |

Cloudflare and Brevo use the Google account's address, so whoever controls that mailbox can reset them. Keep each one's own password and 2-step verification anyway.

### Payment card

The Google billing account (Blaze plan) and Cloudflare are paid with a virtual debit card that has a monthly spending limit, not with anyone's main card. Anyone signed in to these accounts could spend on it, so the limit is the most that can be charged in a month, whatever happens in the accounts.

- **Card:** _which bank or provider, the last four digits, and whose account it draws on._
- **Monthly limit:** _the amount._ It must stay above a normal month's bill, which is about $2 at most (see [costs.md](costs.md)). If a charge is declined, Google can suspend the billing account, which stops Cloud Functions as the budget cap does.
- **Expiry:** _the month it expires._ Add the new card to both accounts before then.

When the account is handed over, the new owner adds their own card to Google and Cloudflare first, then the old card is removed and frozen.

## Signing in and recovery

Signing in must not depend on a single phone. The Google account has:

- **2-step verification:** _the methods turned on, for example an authenticator app and a passkey or security key kept on a second device._
- **Backup codes:** 10 one-time codes, printed. _Where they are kept, and who can reach them._
- **Recovery email:** _an address outside this account, and whose it is._
- **Recovery phone:** _whose number it is._

Cloudflare and Brevo: _their 2-step method and where their recovery codes are kept._

Passwords: _where they are kept, for example the developer's password manager, and how someone else gets them in an emergency._

When a backup code is used, cross it off. When fewer than 3 are left, sign in and print a new set (**Google Account > Security > Backup codes**), and destroy the old sheet.

## Checking it still works

Once a year, and whenever the executives change:

1. Sign in from a device that has not used the account before, using the second 2-step method rather than the usual one.
2. In **Google Account > Security**, check the recovery email and phone are still right and reach someone who is still involved.
3. Check the billing account's card has not expired, in the Google Cloud console under **Billing > Payment method**, and in Cloudflare under **Billing**.
4. Update this page with anything that changed.

| Date | Checked by | Changes |
| ---- | ---------- | ------- |
