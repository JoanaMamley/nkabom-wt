# Shared project accounts

Everything Nkabom runs on belongs to one shared project Google account (FR-8.7), not to any one person. This page says what that account owns, how it is protected, and how to keep it working. Handing the account over to new executives is covered in the rest of the handbook (NKB-708). To create the accounts in the first place, follow [account-setup.md](account-setup.md).

## Keep the details out of the repo

This repo is shared, and anything committed stays in its history. Never put any of these in it, not even partly:

- passwords, backup codes, recovery codes, API keys or the service account key;
- the account's email address, recovery email or recovery phone, or whose they are;
- anything about the payment card, such as the bank, last four digits, limit, expiry or whose account it draws on;
- who holds the backup codes or a sign-in device, or where they are kept.

They are what someone needs to phish the right person or talk a support desk into recovering the account. They go in the **private accounts record**: one entry in the developer's password manager, outside the repo. It holds:

- the sign-in address and password for Google and Cloudflare;
- each account's 2-step methods, and which devices they are on;
- where the printed backup and recovery codes are kept, and who can reach them;
- the recovery email and phone;
- how someone else reaches the record if the developer is unavailable.

## What the account owns

| Account    | Signed in with                      | Owns                                                                                                                                |
| ---------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Google     | Its own Gmail address and password  | Firebase projects `nkabom-staging` and `nkabom-prod` (on the free Spark plan), their Google Cloud projects, the service account the Worker acts as, which from NKB-501 also owns the birthday calendar, and the Gmail mailbox the app's email is sent from |
| Cloudflare | The Gmail address, its own password | The Workers `nkabom-api-staging` and `nkabom-api-prod` and their secrets, and the Workers KV namespaces holding photos and backups |

Cloudflare uses the Gmail address, so whoever controls that mailbox can reset it. It still has its own password and 2-step verification.

## How it is protected

- **Signing in does not depend on one phone.** Each account has 2-step verification with at least two methods on different devices, and printed backup codes kept outside the account.
- **Recovery** goes to a recovery email and phone that do not depend on the account itself.
- **Only the developer signs in.** Executives use the app as admins and do not need the account or the consoles.
- **No card is on Google.** Both Firebase projects stay on the free Spark plan, which cannot be billed.
- **No card is on Cloudflare either.** The Workers and Workers KV free plans need none, and past their daily limits requests fail until midnight UTC instead of being charged. R2 is not used, because it needs a payment method on file.
- **Sending email** goes through Gmail's mail server with an app password, a 16-character password Google makes for one program. It can read the mailbox as well as send, so it exists only as a Worker secret: never in the repo, a file or the private record. To cancel it, remove it at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords); changing the account's password also cancels it.
- **The service account key** lets the Worker act on Firestore, Firebase Auth, push and the calendar with admin rights. It exists only as a Worker secret in each environment: never in the repo, a file or the private record. If it may have leaked, delete it in the Google Cloud console (**IAM & Admin > Service accounts**), create a new one and set it on the Worker again.

When a backup code is used, update the private record. When fewer than 3 are left, sign in and print a new set (**Google Account > Security > Backup codes**), and destroy the old sheet.

## Keeping it working

Once a year, and whenever the executives change:

1. Sign in from a device that has not used the account before, using the second 2-step method rather than the usual one.
2. In **Google Account > Security**, check the recovery email and phone are still right and still reach someone involved.
3. Update the private accounts record with anything that changed.

When the account is handed over:

1. The new owner changes every password and 2-step method, and sets up their own backup codes, recovery email and phone.
2. They replace the service account key, as above, so no copy held by the previous developer still works.
3. Changing the Google password cancels the app password, so email stops until they make a new one and set it on the Worker (README, Email).
4. They start their own private accounts record.
