# Nkabom app

Angular PWA and Firebase backend (Cloud Functions, Firestore rules) for Nkabom, the WomenTrust alumnae community. One repo holds both. Requirements and backlog are in [docs/](docs/).

## Prerequisites

- Node.js 24.x. CI uses it, and the Firebase SDK 13 packages declare Node 24.12+. Node 22.12+ also works for the app.
- Java 11+ (needed by the Firestore emulator)

## Getting started

```sh
npm install
npm start
```

`npm start` runs the Firebase Emulator Suite (Auth, Firestore and Functions) and the Angular dev server together:

| Service     | URL                   |
| ----------- | --------------------- |
| App         | http://localhost:4200 |
| Emulator UI | http://127.0.0.1:4000 |
| Auth        | http://127.0.0.1:9099 |
| Functions   | http://127.0.0.1:5001 |
| Firestore   | http://127.0.0.1:8080 |

Local work uses the `demo-nkabom` project ID, so no Firebase login or credentials are needed. Emulator data is saved to `.emulator-data/` on exit and reloaded on the next start; delete the folder to start fresh.

## Layout

- `src/` Angular app
- `functions/` Cloud Functions (TypeScript, its own `package.json`; `npm install` at the root installs both)
- `firestore.rules`, `firebase.json` Firebase config
- `scripts/` one-off developer scripts, such as icon generation
- `docs/` requirements and backlog

## Scripts

| Command                     | What it does                                           |
| --------------------------- | ------------------------------------------------------ |
| `npm start`                 | Emulators plus dev server                              |
| `npm run serve`             | Dev server only                                        |
| `npm run emulators`         | Builds functions, then runs emulators only             |
| `npm run build:functions`   | Compile Cloud Functions                                |
| `npm test`                  | App unit tests (Vitest)                                |
| `npm run test:functions`    | Cloud Functions tests (Vitest)                         |
| `npm run test:rules`        | Firestore security rules tests (emulator)              |
| `npm run lint`              | ESLint (TypeScript and templates)                      |
| `npm run format`            | Format with Prettier                                   |
| `npm run format:check`      | Check formatting without writing                       |
| `npm run build`             | Production build to `dist/nkabom-app/browser`          |
| `npm run build:staging`     | Same build, with the staging Firebase config           |
| `npm run deploy:staging`    | Staging build, then deploy everything to staging       |
| `npm run deploy:production` | Production build, then deploy everything to production |
| `npm run icons`             | Regenerate the app icons from `public/icons/icon.svg`  |
| `npm run check:contrast`    | Check theme colours are readable in both modes         |

## Continuous integration

GitHub Actions runs [.github/workflows/ci.yml](.github/workflows/ci.yml) on every pull request and on every push to `main`:

| Job      | Runs                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| Frontend | `ng lint`, Prettier check, theme contrast check, app unit tests, production build |
| Backend  | functions lint, Prettier check, functions tests, build                            |
| Rules    | Firestore security rules tests against the emulator                               |
| CI       | passes only if every job above passes                                             |

To stop a failing check from being merged, require the **CI** check in the branch protection (or ruleset) for `main`. It is the only check that needs listing, even when later stories add jobs.

To run the same checks locally:

```sh
npm run lint && npm run format:check && npm run check:contrast && npm test -- --watch=false && npm run build \
  && npm run test:functions && npm run build:functions && npm run test:rules
```

## Configuration and secrets

- `src/environments/environment.development.ts` points the app at the emulators.
- `src/environments/environment.ts` and `environment.staging.ts` hold the production and staging Firebase web config. The committed copies are empty: fill them in locally and keep them out of commits with `git update-index --skip-worktree src/environments/environment.ts src/environments/environment.staging.ts` (see [docs/handbook/account-setup.md](docs/handbook/account-setup.md)). Automated deploys will write them from GitHub secrets (NKB-114).
- Server-side secrets (Cloudflare R2, email provider, Google service account) never go in this repo. `.env*`, `.secret.local`, key files and service account JSON are git-ignored.
- `functions/.env.<project ID>` holds the non-secret Functions settings for that project: `demo-nkabom` for the emulators, `nkabom-staging` and `nkabom-prod` for the real projects. They are the only committed `.env` files; never put secrets in them.
- Secrets are set per project with `firebase functions:secrets:set NAME --project staging` (or `production`) and kept in Google Cloud Secret Manager. A function only sees the secrets it lists in its options. Secret Manager is free for 6 secret versions per billing account, counting both projects, so keep each project to 3 secrets (`R2_CREDENTIALS`, `BREVO_API_KEY`, and the calendar key from NKB-501). Setting a secret again adds a version; after a deploy, `firebase functions:secrets:prune` destroys the versions no longer used.

## Environments and deploys

| Alias        | Project ID       | Used for                                 |
| ------------ | ---------------- | ---------------------------------------- |
| `default`    | `demo-nkabom`    | Emulators only; there is no real project |
| `staging`    | `nkabom-staging` | Trying changes against real services     |
| `production` | `nkabom-prod`    | The live app                             |

Both real projects belong to the shared project Google account (NKB-113). They stay on the free Spark plan, and server code moves from Cloud Functions to a Cloudflare Worker (NKB-115 to NKB-121), since the Blaze plan that Cloud Functions, scheduled functions and Firestore exports need could not be turned on without paying. Until NKB-121, the sections below still describe the Cloud Functions set-up. Because the default alias is the demo project, a bare `firebase deploy` fails instead of reaching a real project: always name one.

Deploy by hand with `npm run deploy:staging` or `npm run deploy:production`. Each builds the app with that project's config and deploys Hosting, Cloud Functions, and Firestore rules and indexes together. Sign in first with `npx firebase login`, using the shared project account. Automated deploys come in NKB-114.

Firebase Hosting serves only HTTPS (FR-8.2): it redirects plain HTTP and sends a `Strict-Transport-Security` header itself, so `firebase.json` does not set one.

### Setting up a project

Create the shared project accounts (Google and Cloudflare) first, following [docs/handbook/account-setup.md](docs/handbook/account-setup.md), which also walks through steps 1, 3 and 4 below in the consoles. How the accounts are protected and recovered is in [docs/handbook/accounts.md](docs/handbook/accounts.md).

The projects stay on Spark, so skip the Blaze, budget and backup bucket steps (2, 7 and 8); the Worker set-up replaces steps 5 and 6 in NKB-115. Once for each of `nkabom-staging` and `nkabom-prod`, signed in as the shared project account:

1. In the [Firebase console](https://console.firebase.google.com), create the project with exactly that ID. If the ID is taken, choose another and change it in `.firebaserc`, the `functions/.env.<project ID>` file name, its `BACKUP_BUCKET`, and `.gitignore`.
2. Upgrade to the Blaze plan under **Usage and billing**.
3. **Firestore Database > Create database** in production mode. The location cannot be changed later; use the same one for both projects.
4. **Project settings > Your apps**: add a web app, then copy its config into `src/environments/environment.staging.ts` (staging) or `environment.ts` (production), locally only (see [Configuration and secrets](#configuration-and-secrets)).
5. Set the secrets for photos and email (see [Setting up a bucket](#setting-up-a-bucket) and [Setting up Brevo](#setting-up-brevo)), adding `--project staging` or `--project production`.
6. Run `npm run deploy:staging` (or `deploy:production`). The first deploy asks for any setting missing from the `.env` file, such as `EMAIL_FROM`, and saves the answer there; commit it.
7. Create the backup bucket: `scripts/create-backup-bucket.sh nkabom-staging` (or `nkabom-prod`; see [Backups](#backups)). It comes after the first deploy, which creates the service account the backup runs as.
8. Set the budget and its cap: `scripts/create-budget.sh nkabom-staging 0.50` or `scripts/create-budget.sh nkabom-prod 1.50` (see [Costs](#costs)).

## Installable app (PWA)

Production builds are an installable PWA (FR-4.10): a web app manifest, icons and a service worker. Firebase Hosting serves the app over HTTPS.

- **Manifest and icons:** [public/manifest.webmanifest](public/manifest.webmanifest) and [public/icons/](public/icons/). The icon is a placeholder "N" until there is a logo. Every PNG and `favicon.ico` are rendered from `public/icons/icon.svg`: replace the SVG, keeping the artwork inside the central 80% circle so it also works as a maskable icon, then run `npm run icons` (it needs Google Chrome; set `CHROME` to its path outside macOS). The brand colour `#e95300` is also set in the manifest, `src/index.html` and `src/app/core/theme.ts`; the site colours live in `src/styles.scss` (see [Light and dark theme](#light-and-dark-theme)).
- **Service worker:** the app registers [public/sw.js](public/sw.js), which loads Angular's service worker ([ngsw-config.json](ngsw-config.json)). Push handling for NKB-509 goes in the same file. Keep the name `sw.js`: changing the registered script strands installed copies on the old worker. It is on in production builds only, so `ng serve` always shows the latest code.
- **Offline:** the service worker caches the app, so it opens without a connection. While the device is offline, an offline page covers the current page. The page underneath stays in place, so a half-filled form survives a dropped connection.
- **Updates:** after a deploy, open copies keep the version they started with, and a bar offers to reload once the new version has downloaded.
- **Caching:** `firebase.json` serves `index.html`, app routes, the service worker files and the manifest with `Cache-Control: no-cache`, so the browser always checks for a new version.

To try it locally, build and serve with the Hosting emulator, then open it in Chrome (`localhost` counts as secure, so the service worker runs):

```sh
npm run build && npx firebase emulators:start --only hosting --project demo-nkabom
```

The app is then at http://localhost:5050 (not 5000, which macOS uses for AirPlay Receiver).

Until `src/environments/environment.ts` holds the real config (see [Setting up a project](#setting-up-a-project)), a production build stops at startup with `auth/invalid-api-key`. To try it before then, temporarily use the demo values from `environment.development.ts` and do not commit them.

Installing: on Android, Chrome offers **Install app** (or **Add to Home screen**). On iPhone, Safari: **Share > Add to Home Screen**. iOS uses `apple-touch-icon.png`, not the manifest icons. Lighthouse 12 removed its PWA category, so check installability in Chrome DevTools under **Application > Manifest**, which lists any installability errors.

## Light and dark theme

Every page has a light and a dark mode (FR-8.8 to FR-8.10). On a first visit the site follows the device setting; once someone presses the toggle in the header, their choice is saved in the browser (`localStorage`, key `nkabom-theme`) and applies to every page and open tab on that device.

- **Colours** live only in [src/styles.scss](src/styles.scss), as CSS custom properties (`--color-bg`, `--color-text`, `--color-primary` and so on), with a light and a dark value each. Components use the properties, never raw colours, so new screens work in both modes.
- **Brand colour** is `#e95300`. White text on it is too faint (3.68:1), so buttons use dark text (`--color-on-primary`), and links in light mode use the deeper `#b84200`.
- **Contrast:** `npm run check:contrast` checks every text colour against both backgrounds at WCAG AA (4.5:1) and borders and controls at 3:1, in both modes. CI runs it, so a colour change that makes text hard to read fails the build.
- **No flash:** a small inline script in `src/index.html` applies a saved choice before the page first paints. [src/app/core/theme.ts](src/app/core/theme.ts) takes over once the app starts, and also sets the browser bar colour.

## Photo storage (Cloudflare R2)

Being replaced: R2 needs a payment method on file, so NKB-116 moves photos to Workers KV, with links signed by the Worker. Do not set up the R2 buckets below.

Photos live in a private R2 bucket. The browser never gets the bucket's keys: it calls a Cloud Function for a short-lived signed link and uploads or downloads with that.

| Function              | Takes                   | Returns                                                      |
| --------------------- | ----------------------- | ------------------------------------------------------------ |
| `getPhotoUploadUrl`   | `{ contentType, size }` | `{ url, path, expiresIn }`: a 5-minute PUT link and the path |
| `getPhotoDownloadUrl` | `{ path }`              | `{ url, expiresIn }`: a 10-minute GET link                   |

The upload link accepts only a file of the declared type (JPG, PNG or WebP) and exact size (up to 5 MB): PUT it with that `Content-Type`. Save the returned `path` as the profile's `photoPath`; the Firestore rules accept only a path in the member's own `photos/{uid}/` folder. For now members can download only their own photo.

Without R2 settings the emulators still run, and both functions answer `failed-precondition` ("Photo storage is not configured").

### Setting up a bucket

Once per Firebase project (staging and production), in the shared project Cloudflare account:

1. **R2 > Create bucket**: `nkabom-photos` for production, `nkabom-photos-staging` for staging (the `R2_BUCKET` in each `functions/.env.<project ID>`). Both live in one Cloudflare account, so the names must differ. Leave public access off (no r2.dev URL, no custom domain), so files open only through signed links.
2. In the bucket's **Settings > CORS policy**, allow the app to upload and download:

   ```json
   [
     {
       "AllowedOrigins": [
         "http://localhost:4200",
         "https://<project ID>.web.app",
         "https://<project ID>.firebaseapp.com"
       ],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **R2 > Manage API tokens > Create API token** with **Object Read & Write**, limited to this bucket. Note the access key ID and secret access key; the secret is shown once.
4. Store the three values as one secret, `R2_CREDENTIALS`, in JSON (the account ID is on the R2 overview page):

   ```sh
   printf '%s' '{"accountId":"…","accessKeyId":"…","secretAccessKey":"…"}' \
     | firebase functions:secrets:set R2_CREDENTIALS --data-file=- --project staging
   ```

   One secret instead of three keeps Secret Manager free (see [Configuration and secrets](#configuration-and-secrets)).

Add a custom domain to `AllowedOrigins` if the app later gets one. Leave `localhost` out of the production bucket's list.

To use a real bucket from the emulators, put the same JSON in `functions/.secret.local` (git-ignored), in single quotes: `R2_CREDENTIALS='{"accountId":"…",…}'`.

## Email

Cloud Functions send every email through `sendEmail` in [functions/src/email.ts](functions/src/email.ts), using a template from [functions/src/email-templates.ts](functions/src/email-templates.ts), the one place email wording lives (FR-8.5):

```ts
await sendEmail({ email, name }, 'registrationApproved', { firstName, appUrl });
```

A function that sends email must list the provider's secret: `onCall({ secrets: emailSecrets }, ...)`. Each template gives its text once, and both the plain-text and HTML versions are built from it, with typed-in values escaped. To add an email, add a template there; TypeScript then checks every caller's data.

A failed send is logged to Cloud Logging as `Email send failed`, with the provider, template, recipient and error but not the body, since that may hold a one-time link. The error is then thrown, so the caller can retry or fall back.

| Setting           | Kind   | Value                                                                  |
| ----------------- | ------ | ---------------------------------------------------------------------- |
| `EMAIL_PROVIDER`  | string | `brevo` (default), or `log` to write emails to the Functions log       |
| `EMAIL_FROM`      | string | Sender address, on a domain verified with the provider                 |
| `EMAIL_FROM_NAME` | string | Sender name (default `Nkabom`)                                         |
| `BREVO_API_KEY`   | secret | Brevo API key, set with `firebase functions:secrets:set BREVO_API_KEY` |

The emulators use `log` (set in `functions/.env.demo-nkabom`), so nothing is sent locally: emails, links included, show in the Functions log in the Emulator UI. Never use `log` in a deployed project.

To switch provider, add a function for it in [functions/src/email-providers.ts](functions/src/email-providers.ts) and a case in `email.ts`, then change `EMAIL_PROVIDER`. Callers and templates do not change.

### Setting up Brevo

Not used: Brevo needs a domain the project does not have, so NKB-117 sends email through the shared Gmail account instead, and this section is replaced then.

Brevo's free plan sends up to 300 emails a day, shared by staging and production since both use one account.

1. Once: create a Brevo account with the shared project Google account (NKB-113).
2. Once: **Settings > Senders, domains, IPs > Domains**: add the sending domain and add the DNS records Brevo shows (DKIM, DMARC, and the Brevo code), so mail is not marked as spam.
3. Once, after creating the API keys: [app.brevo.com/security/authorised_ips](https://app.brevo.com/security/authorised_ips) (**Settings > Security > Authorized IPs**) **> Deactivate blocking.** The server sends from changing addresses, so Brevo's IP blocking would otherwise start rejecting it once it stops learning new ones.
4. Per project: **SMTP & API > API keys**: create a key named after the project (so one can be revoked without the other), then run `firebase functions:secrets:set BREVO_API_KEY --project staging` (or `production`).
5. The first deploy asks for `EMAIL_FROM`, an address on that domain.

## Scheduled jobs

Reminders, calendar sync and backups run as scheduled Cloud Functions. Make each one with `scheduledJob` from [functions/src/scheduled.ts](functions/src/scheduled.ts) rather than `onSchedule`:

```ts
export const sendReminders = scheduledJob(
  'sendReminders',
  { schedule: 'every day 08:00' },
  async () => {
    // ...
  },
);
```

Then export it from [functions/src/index.ts](functions/src/index.ts). Every job:

- **Runs on Accra time.** A schedule like `every day 08:00` (or cron syntax, `0 8 * * *`) means 08:00 in Ghana.
- **Is retried when it fails.** Cloud Scheduler tries a failed run again 3 times, after 1, 2 and 4 minutes. A job can pass its own `retryCount` and backoff settings. A retry repeats the whole run, so write jobs to skip work that is already done, for example by recording what was sent.
- **Logs each run** to Cloud Logging, with the job name, the scheduled time and how long it took: `Scheduled job finished`, or `Scheduled job failed` with the error and stack. To find failures, search Logs Explorer for `jsonPayload.message="Scheduled job failed"`.

The emulator does not run scheduled jobs. Test the handler with `job.run(...)`, as in [scheduled.spec.ts](functions/src/scheduled.spec.ts).

Cloud Scheduler gives 3 free jobs per billing account, then charges $0.10 a month for each job, counting every job in every project. So that it stays free:

- **One daily job per project for periodic tasks.** Reminders, clean-ups and other once-a-day work (NKB-308, NKB-512, NKB-707) run as tasks inside a single daily job, not as jobs of their own. The first story that needs one creates it with `scheduledJob` and moves the Firestore backup into it as a task; later stories add their task to it. Each task must be safe to run again, since a retry reruns them all, and one failing task must not stop the others from running.
- **Its own job only when daily is not enough,** such as a check every few minutes. Note the extra cost in [docs/handbook/costs.md](docs/handbook/costs.md).

Until the daily job exists, the backup is its own job. After that, each project has just the daily job: 2 jobs in total, within the free 3.

### Heartbeat

`schedulerHeartbeat` runs every day at 06:00 and does nothing but succeed. It is temporary: it was meant to check scheduled jobs on staging once. NKB-119 now does that check with the Worker's triggers, and NKB-121 removes the heartbeat.

To check retries and error logs on staging:

1. In Cloud Scheduler, **Force run** `firebase-schedule-schedulerHeartbeat-us-central1`. Logs Explorer shows `Scheduled job finished`.
2. Set `HEARTBEAT_FAIL=true` in `functions/.env.nkabom-staging` and run `npx firebase deploy --only functions:schedulerHeartbeat --project staging`.
3. Force run it again. Logs Explorer shows `Scheduled job failed` four times (the run and its 3 retries) over about 7 minutes.
4. Set `HEARTBEAT_FAIL=false` and deploy again. Do not commit it set to true.
5. Remove the heartbeat: delete `schedulerHeartbeat` and its `HEARTBEAT_FAIL` setting from `scheduled.ts`, `index.ts`, the tests, `functions/.env.nkabom-staging` and `functions/.env.demo-nkabom`, and remove this section. The next deploy to each project asks to delete the function; say yes.

## Costs

The app should cost under $5 a month. The guardrails (NKB-112):

- **Budgets:** $1.50 a month for production and $0.50 for staging, made by [scripts/create-budget.sh](scripts/create-budget.sh). Alert emails go to the shared project account at 50%, 90% and 100%, and when the month is forecast to pass the budget.
- **Cap:** `enforceBudget` in [functions/src/costs.ts](functions/src/costs.ts) receives each project's budget notifications on the `budget-alerts` topic, and turns off that project's billing once actual spend reaches its budget. Functions then stop until billing is turned back on by hand.
- **Instance limit:** [functions/src/global-options.ts](functions/src/global-options.ts) caps every function at 10 instances. `index.ts` imports it first, and a test checks every exported function has the cap.

What to check each month, and what to do when an alert arrives, is in the handbook: [docs/handbook/costs.md](docs/handbook/costs.md).

## Backups

`backupFirestore` in [functions/src/backups.ts](functions/src/backups.ts) exports the whole Firestore database every day at 02:00 Accra time (FR-8.6), to `BACKUP_BUCKET/firestore/<UTC time>`, for example `gs://nkabom-prod-backups/firestore/2026-10-20T02-00-00Z`. It is a [scheduled job](#scheduled-jobs), so a failed export is retried and logged. The bucket deletes exports after 30 days.

Exports hold Firestore only. Photos are in R2 and Auth accounts in Firebase Auth, neither of which this covers.

### Setting up the backup bucket

Once per project, after its first deploy, with the [gcloud CLI](https://cloud.google.com/sdk/docs/install) signed in as the shared project account:

```sh
scripts/create-backup-bucket.sh nkabom-staging   # or nkabom-prod
```

It creates `gs://<project ID>-backups`, private and in the Firestore database's location, applies [scripts/backup-lifecycle.json](scripts/backup-lifecycle.json) (delete after 30 days), and lets the default compute service account, which `backupFirestore` runs as, start exports and write them to the bucket. Running it again only updates the settings.

To check it, run the job now from **Cloud Scheduler** in the Google Cloud console (**Force run** on `firebase-schedule-backupFirestore-us-central1`), then see that a new folder appears in the bucket.

### Restoring

An import writes every document in the export over the document with the same path. It does not delete documents created since the export. Restore into a new database first, check it, and only then into `(default)`.

1. Pick the export: `gcloud storage ls gs://$PROJECT-backups/firestore/`.
2. Create a database to restore into, in the same location:

   ```sh
   gcloud firestore databases create --database=restore-check --location=$LOCATION --project=$PROJECT
   gcloud firestore import gs://$PROJECT-backups/firestore/<time> --database=restore-check --project=$PROJECT
   ```

   The command waits until the import finishes. Follow a long one with `gcloud firestore operations list --database=restore-check --project=$PROJECT`.

3. In the Firebase console, open the `restore-check` database and check the collections and a few documents you know.
4. To put the data back in the live database, during a quiet time, run the same import without `--database`. Firestore rules do not apply to an import.
5. Delete the check database: `gcloud firestore databases delete --database=restore-check --project=$PROJECT`.

### Restore tests

Test a restore on staging once a year and after any change to the backup set-up, then add a row here.

| Date | Project | Export | Result |
| ---- | ------- | ------ | ------ |

## Data model

Types and collection names live in [functions/src/model.ts](functions/src/model.ts). [firestore.rules](firestore.rules) validates the same shapes, so change the two together.

| Collection        | Document ID | Holds                                                                                   | Written by                                    |
| ----------------- | ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| `users/{uid}`     | Auth UID    | Role: `member`, `admin` or `primaryAdmin`                                               | Cloud Functions only                          |
| `members/{uid}`   | Auth UID    | Profile, and status: `pending`, `active`, `rejected` or `deactivated`                   | The member creates it, as pending             |
| `directory/{uid}` | Auth UID    | Limited profile of an active member: name, photo, course or occupation, graduation year | `syncDirectoryEntry` only                     |
| `auditLog/{id}`   | Auto ID     | Admin actions: actor, action, target, time                                              | Cloud Functions only, never edited or deleted |

### Full records and the directory

A member's full record, with date of birth and status, stays in `members/{uid}`, which only that member can read (and admins, from NKB-208). Other members see only `directory/{uid}`, which holds the FR-5.2 fields and nothing else (FR-3.1).

The `syncDirectoryEntry` function in [functions/src/directory.ts](functions/src/directory.ts) runs on every write to `members/{uid}`. It lists a member once their status is `active`, copies changes to the listed fields, and removes the entry when the member is no longer active or the profile is deleted. It reads the profile again in a transaction rather than trusting the event, so a late or repeated event cannot leave an old entry behind, and a failed sync is retried. Only active members can read the directory, so pending members see nothing (FR-2.9).

To show another field to members, add it to `DIRECTORY_FIELDS` in `model.ts` and check FR-5.2 and the privacy notice first. Date of birth and contact details must never be added.

### Audit log

To record an admin action from a Cloud Function, call `recordAudit` from [functions/src/audit.ts](functions/src/audit.ts):

```ts
await recordAudit(request.auth, 'registration.approve', { type: 'member', id: uid });
```

Using the user ID as the document ID means a user can have only one profile: the rules deny a second write. The `createUserRecord` function writes a `member` record for every new account. Anything the rules do not open is denied (FR-1.12). The rules tests in `tests/` start each case from an empty emulator database.
