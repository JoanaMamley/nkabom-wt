# Nkabom app

Angular PWA, Firebase (Firestore rules, and Cloud Functions until NKB-120) and a Cloudflare Worker API for Nkabom, the WomenTrust alumnae community. One repo holds both. Requirements and backlog are in [docs/](docs/).

## Prerequisites

- Node.js 24.x. CI uses it, and the Firebase SDK 13 packages declare Node 24.12+. Node 22.12+ also works for the app.
- Java 11+ (needed by the Firestore emulator)

## Getting started

```sh
npm install
npm start
```

`npm start` runs the Firebase Emulator Suite (Auth, Firestore and Functions), the Worker and the Angular dev server together:

| Service     | URL                   |
| ----------- | --------------------- |
| App         | http://localhost:4200 |
| Worker API  | http://127.0.0.1:8787 |
| Emulator UI | http://127.0.0.1:4000 |
| Auth        | http://127.0.0.1:9099 |
| Functions   | http://127.0.0.1:5001 |
| Firestore   | http://127.0.0.1:8080 |

Local work uses the `demo-nkabom` project ID, so no Firebase login or credentials are needed. Emulator data is saved to `.emulator-data/` on exit and reloaded on the next start; delete the folder to start fresh.

## Layout

- `src/` Angular app
- `functions/` Cloud Functions (TypeScript, its own `package.json`; `npm install` at the root installs it), removed in NKB-120
- `worker/` the Cloudflare Worker, the app's API (TypeScript, its own `package.json`, also installed by `npm install` at the root)
- `firestore.rules`, `firebase.json` Firebase config
- `scripts/` one-off developer scripts, such as icon generation
- `docs/` requirements and backlog

## Scripts

| Command                     | What it does                                           |
| --------------------------- | ------------------------------------------------------ |
| `npm start`                 | Emulators plus dev server                              |
| `npm run serve`             | Dev server only                                        |
| `npm run emulators`         | Builds functions, then runs emulators only             |
| `npm run worker`            | Worker only, with `wrangler dev`                       |
| `npm run build:functions`   | Compile Cloud Functions                                |
| `npm run build:worker`      | Type-check the Worker and bundle it (dry run)          |
| `npm test`                  | App unit tests (Vitest)                                |
| `npm run test:functions`    | Cloud Functions tests (Vitest)                         |
| `npm run test:worker`       | Worker tests (Vitest, in the Workers runtime)          |
| `npm run test:rules`        | Firestore security rules tests (emulator)              |
| `npm run lint`              | ESLint (TypeScript and templates)                      |
| `npm run format`            | Format with Prettier                                   |
| `npm run format:check`      | Check formatting without writing                       |
| `npm run build`             | Production build to `dist/nkabom-app/browser`          |
| `npm run build:staging`     | Same build, with the staging Firebase config           |
| `npm run deploy:staging`    | Staging build, then deploy everything to staging       |
| `npm run deploy:production` | Production build, then deploy everything to production |

"Everything" is Hosting, Firestore rules and indexes, and the Worker. Cloud Functions are left out, since they need the Blaze plan.
| `npm run icons` | Regenerate the app icons from `public/icons/icon.svg` |
| `npm run check:contrast` | Check theme colours are readable in both modes |

## Continuous integration

GitHub Actions runs [.github/workflows/ci.yml](.github/workflows/ci.yml) on every pull request and on every push to `main`:

| Job      | Runs                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| Frontend | `ng lint`, Prettier check, theme contrast check, app unit tests, production build |
| Backend  | functions lint, Prettier check, functions tests, build                            |
| Worker   | Worker lint, Prettier check, type check, tests, and a dry-run build               |
| Rules    | Firestore security rules tests against the emulator                               |
| CI       | passes only if every job above passes                                             |

To stop a failing check from being merged, require the **CI** check in the branch protection (or ruleset) for `main`. It is the only check that needs listing, even when later stories add jobs.

To run the same checks locally:

```sh
npm run lint && npm run format:check && npm run check:contrast && npm test -- --watch=false && npm run build \
  && npm run test:functions && npm run build:functions && npm run test:worker && npm run build:worker \
  && npm run test:rules
```

## Configuration and secrets

- `src/environments/environment.development.ts` points the app at the emulators.
- `src/environments/environment.ts` and `environment.staging.ts` hold the production and staging Firebase web config. The committed copies are empty: fill them in locally and keep them out of commits with `git update-index --skip-worktree src/environments/environment.ts src/environments/environment.staging.ts` (see [docs/handbook/account-setup.md](docs/handbook/account-setup.md)). Automated deploys will write them from GitHub secrets (NKB-121).
- Server-side secrets (Cloudflare R2, email provider, Google service account) never go in this repo. `.env*`, `.secret.local`, key files and service account JSON are git-ignored.
- The Worker's settings are in [worker/wrangler.jsonc](worker/wrangler.jsonc), one block per environment, and its secrets are set with `wrangler secret put` (see [Worker](#worker)). They never go in the repo.
- `functions/.env.<project ID>` holds the non-secret Functions settings for that project: `demo-nkabom` for the emulators, `nkabom-staging` and `nkabom-prod` for the real projects. They are the only committed `.env` files; never put secrets in them.
- Secrets are set per project with `firebase functions:secrets:set NAME --project staging` (or `production`) and kept in Google Cloud Secret Manager. A function only sees the secrets it lists in its options. Secret Manager is free for 6 secret versions per billing account, counting both projects, so keep each project to 3 secrets (`R2_CREDENTIALS`, `BREVO_API_KEY`, and the calendar key from NKB-501). Setting a secret again adds a version; after a deploy, `firebase functions:secrets:prune` destroys the versions no longer used.

## Environments and deploys

| Alias        | Project ID       | Used for                                 |
| ------------ | ---------------- | ---------------------------------------- |
| `default`    | `demo-nkabom`    | Emulators only; there is no real project |
| `staging`    | `nkabom-staging` | Trying changes against real services     |
| `production` | `nkabom-prod`    | The live app                             |

Both real projects belong to the shared project Google account (NKB-113). They stay on the free Spark plan, and server code moves from Cloud Functions to a Cloudflare Worker (NKB-114 to NKB-120), since the Blaze plan that Cloud Functions, scheduled functions and Firestore exports need could not be turned on without paying. Until NKB-120, the sections below still describe the Cloud Functions set-up. Because the default alias is the demo project, a bare `firebase deploy` fails instead of reaching a real project: always name one.

Deploy by hand with `npm run deploy:staging` or `npm run deploy:production`. Each builds the app with that project's config and deploys Hosting, Firestore rules and indexes, and that environment's Worker together. Sign in first with `npx firebase login` and `npx wrangler login`, using the shared project accounts. Automated deploys come in NKB-121.

Firebase Hosting serves only HTTPS (FR-8.2): it redirects plain HTTP and sends a `Strict-Transport-Security` header itself, so `firebase.json` does not set one.

### Setting up a project

Create the shared project accounts (Google and Cloudflare) first, following [docs/handbook/account-setup.md](docs/handbook/account-setup.md), which also walks through steps 1, 3 and 4 below in the consoles. How the accounts are protected and recovered is in [docs/handbook/accounts.md](docs/handbook/accounts.md).

The projects stay on Spark, so skip the Blaze, budget and backup bucket steps (2, 7 and 8), and do [Setting up the Worker](#setting-up-the-worker) in place of steps 5 and 6. Once for each of `nkabom-staging` and `nkabom-prod`, signed in as the shared project account:

1. In the [Firebase console](https://console.firebase.google.com), create the project with exactly that ID. If the ID is taken, choose another and change it in `.firebaserc`, the `functions/.env.<project ID>` file name, its `BACKUP_BUCKET`, and `.gitignore`.
2. Upgrade to the Blaze plan under **Usage and billing**.
3. **Firestore Database > Create database** in production mode. The location cannot be changed later; use the same one for both projects.
4. **Project settings > Your apps**: add a web app, then copy its config into `src/environments/environment.staging.ts` (staging) or `environment.ts` (production), locally only (see [Configuration and secrets](#configuration-and-secrets)).
5. Set the email secret (see [Setting up Brevo](#setting-up-brevo)), adding `--project staging` or `--project production`. Photos no longer need one here: they use the Worker's `PHOTO_LINK_KEY`.
6. Run `npm run deploy:staging` (or `deploy:production`). The first deploy asks for any setting missing from the `.env` file, such as `EMAIL_FROM`, and saves the answer there; commit it.
7. Create the backup bucket: `scripts/create-backup-bucket.sh nkabom-staging` (or `nkabom-prod`; see [Backups](#backups)). It comes after the first deploy, which creates the service account the backup runs as.
8. Set the budget and its cap: `scripts/create-budget.sh nkabom-staging 0.50` or `scripts/create-budget.sh nkabom-prod 1.50` (see [Costs](#costs)).

## Worker

The app's API is one Cloudflare Worker per environment, on the free plan at its `workers.dev` address, under the shared Cloudflare account's subdomain `nkabomwt-project`:

| Environment | Worker               | Address                                                 |
| ----------- | -------------------- | ------------------------------------------------------- |
| Local       | `nkabom-api`         | http://127.0.0.1:8787                                   |
| Staging     | `nkabom-api-staging` | https://nkabom-api-staging.nkabomwt-project.workers.dev |
| Production  | `nkabom-api-prod`    | https://nkabom-api-prod.nkabomwt-project.workers.dev    |

Writes with side effects (registration, profile edits, approvals, admin changes, mentorship, publishing, exports) go through it; the app reads Firestore directly. The code is in [worker/src/](worker/src/).

Every endpoint except `/health` and the signed photo links starts by checking the caller's Firebase ID token with `requireUser` from [worker/src/auth.ts](worker/src/auth.ts), so admin routes are enforced on the server, not only hidden in the app (FR-1.11). The token must be signed by Google, issued for that environment's project, unexpired, and name a user; otherwise the answer is `401`. The Worker then reaches Firestore through its REST API, as the project's service account, which bypasses the Firestore rules the way the Admin SDK does. For now it only reads (`getDocument`); the stories that move writes to the Worker add writes and Firebase Auth calls the same way.

| Endpoint      | Needs sign-in | Returns                                                                      |
| ------------- | ------------- | ---------------------------------------------------------------------------- |
| `GET /health` | No            | `{ ok: true }`                                                               |
| `GET /v1/me`  | Yes           | `{ uid, role }`: the caller's role from `users/{uid}`, or `null` without one |

The photo endpoints are listed under [Photo storage](#photo-storage).

`/v1/me` is the test endpoint for this set-up. Send the token as `Authorization: Bearer <ID token>`. Errors come back as `{ error }` with the status; an unexpected failure is a `500` whose details go only to the Worker's log, as `Request failed`.

**CORS:** only the origins in `ALLOWED_ORIGINS` (the app's `web.app` and `firebaseapp.com` addresses, and `localhost:4200` locally) get CORS headers, for `GET`, `POST`, `PUT` and `DELETE` with `Authorization` and `Content-Type`. Add a custom domain there if the app later gets one.

**Adding an endpoint:** add a case to `route` in [worker/src/index.ts](worker/src/index.ts), call `requireUser` first, and throw `HttpError` for answers such as `400` or `403`. Firestore helpers are in [worker/src/firestore.ts](worker/src/firestore.ts).

### Settings and secrets

| Name                          | Kind    | Value                                                                                            |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `FIREBASE_PROJECT_ID`         | setting | `nkabom-staging` or `nkabom-prod`; `demo-nkabom` locally                                         |
| `ALLOWED_ORIGINS`             | setting | Origins allowed by CORS, comma-separated                                                         |
| `FIRESTORE_EMULATOR_HOST`     | setting | Local only: the Firestore emulator                                                               |
| `FIREBASE_AUTH_EMULATOR_HOST` | setting | Local only: the Auth emulator                                                                    |
| `PHOTOS`, `BACKUPS`           | KV      | The environment's Workers KV namespaces for photos (NKB-115) and backups (NKB-119)               |
| `GOOGLE_SERVICE_ACCOUNT`      | secret  | The project's Firebase service account key, the whole JSON file                                  |
| `PHOTO_LINK_KEY`              | secret  | A random key that signs photo links; a fixed value locally (see [Photo storage](#photo-storage)) |

Settings and KV namespace IDs are in [worker/wrangler.jsonc](worker/wrangler.jsonc). The staging and production blocks do not inherit the local ones, so the emulator settings never reach a deployed Worker, and the Worker also accepts emulator tokens only for a `demo-` project. Secrets are set per environment with `npx wrangler secret put NAME --env staging` (or `production`), run in `worker/`; each one is stored encrypted by Cloudflare and cannot be read back. Worker secrets are free.

### Local development

`npm start` (or `npm run worker` next to `npm run emulators`) runs the Worker with `wrangler dev` at http://127.0.0.1:8787, against the Auth and Firestore emulators, and with local KV kept in `worker/.wrangler/`. No Cloudflare sign-in or secrets are needed. The Auth emulator issues unsigned tokens, so locally the Worker instead checks that the token's user exists in the emulator.

To try it by hand, make a user in the Auth emulator and call the API with its token:

```sh
TOKEN=$(curl -s 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key' \
  -H 'Content-Type: application/json' \
  -d '{"email":"ama@example.com","password":"secret123","returnSecureToken":true}' | jq -r .idToken)
curl -s http://127.0.0.1:8787/v1/me -H "Authorization: Bearer $TOKEN"
```

The answer is `{"uid":"…","role":"member"}`: the Functions emulator's `createUserRecord` writes the `users` record for every new account (until NKB-117 moves that to the Worker). Without the header the answer is `401`.

Tests run inside the Workers runtime with `@cloudflare/vitest-plugin` (`npm run test:worker`). They stand in for Google's keys, token exchange and Firestore, so they need no network or emulators.

### Setting up the Worker

Once, in `worker/`, signed in as the shared project accounts (see [docs/handbook/account-setup.md](docs/handbook/account-setup.md)):

1. **Sign in to Cloudflare:** `npx wrangler login`, choose the shared Cloudflare account and click **Allow**. `npx wrangler whoami` then shows the shared account's address.
2. **Create the KV namespaces,** two per environment:

   ```sh
   npx wrangler kv namespace create nkabom-photos-staging
   npx wrangler kv namespace create nkabom-backups-staging
   npx wrangler kv namespace create nkabom-photos-prod
   npx wrangler kv namespace create nkabom-backups-prod
   ```

   If Wrangler offers to add each one to the config, say no. Put each printed `id` in place of the matching `REPLACE_WITH_…` in [worker/wrangler.jsonc](worker/wrangler.jsonc), and commit it: the IDs are not secret.

3. **Deploy staging:** from the repo root, `npm run deploy:staging`. It deploys Hosting, the Firestore rules and indexes, and `nkabom-api-staging`. At the end Wrangler prints the Worker's address, which should match the [table above](#worker). The middle part is the account's `workers.dev` subdomain, `nkabomwt-project`; if it ever changes, update the table. For production, deploy only the Worker for now, so its secrets have somewhere to go: `npm --prefix worker run deploy:production`. Nobody calls it until the app does.
4. **Set the service account key,** for each project. In the [Firebase console](https://console.firebase.google.com), open the project, then **Project settings > Service accounts > Generate new private key**. A JSON file downloads. In `worker/`:

   ```sh
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT --env staging < ~/Downloads/nkabom-staging-firebase-adminsdk-….json
   ```

   (`--env production` with the `nkabom-prod` key.) Then delete the file and empty the Bin: the secret is the only copy. If a key is lost or leaks, generate a new one, set it again, and delete the old key in the Google Cloud console under **IAM & Admin > Service accounts > firebase-adminsdk > Keys**.

5. **Set the photo-link key,** a different random value per environment, never kept anywhere else:

   ```sh
   openssl rand -base64 32 | npx wrangler secret put PHOTO_LINK_KEY --env staging
   openssl rand -base64 32 | npx wrangler secret put PHOTO_LINK_KEY --env production
   ```

   Changing it later only ends the photo links already handed out.

6. **Check staging** (see below).

`npx wrangler secret list --env staging` shows which secrets are set, without their values. Logs from a deployed Worker are on its **Logs** tab in the dashboard (**Workers & Pages > nkabom-api-staging**), kept for 3 days; `npx wrangler tail --env staging` follows them live.

### Checking staging

1. In the Firebase console for `nkabom-staging`: **Authentication > Sign-in method**, turn on **Email/Password** if it is off (members use it too, FR-1.1). Then **Authentication > Users > Add user** with a test address and password, and note its **User UID**.
2. Get an ID token for it, using the `apiKey` from `src/environments/environment.staging.ts`:

   ```sh
   API=https://nkabom-api-staging.nkabomwt-project.workers.dev
   TOKEN=$(curl -s "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<apiKey>" \
     -H 'Content-Type: application/json' \
     -d '{"email":"<test address>","password":"<password>","returnSecureToken":true}' | jq -r .idToken)
   ```

3. `curl -s $API/v1/me` answers `401` `{"error":"Sign in required"}`.
4. `curl -s $API/v1/me -H "Authorization: Bearer ${TOKEN%?}x"` (the token with its last character changed) answers `401` `{"error":"Invalid or expired sign-in"}`.
5. `curl -s $API/v1/me -H "Authorization: Bearer $TOKEN"` answers `{"uid":"<User UID>","role":null}`: no `users` record yet, since nothing creates one on staging until NKB-117.
6. In **Firestore Database**, add a document to `users` with the User UID as its ID and a string field `role` set to `member`. Call step 5 again: it answers `"role":"member"`, read from Firestore through the service account. Leave the user and document in place as data for the restore test (NKB-119).
7. Open the staging app at `https://nkabom-staging.web.app` and check it loads.

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

## Photo storage

Photos live in the Worker's private `PHOTOS` Workers KV namespace, one per environment (FR-2.3, FR-8.2). Nothing else can read it: the browser asks the Worker for a short-lived signed link, then uploads or downloads through the Worker with that link. The code is in [worker/src/photos.ts](worker/src/photos.ts).

| Endpoint                       | Takes                   | Returns                                                      |
| ------------------------------ | ----------------------- | ------------------------------------------------------------ |
| `POST /v1/photos/upload-url`   | `{ contentType, size }` | `{ url, path, expiresIn }`: a 5-minute PUT link and the path |
| `POST /v1/photos/download-url` | `{ path }`              | `{ url, expiresIn }`: a 10-minute GET link                   |

Both need a sign-in, like every endpoint. The links themselves do not: they point at the Worker's own address, `/photos/{uid}/{uuid}.{ext}`, and carry an HMAC-SHA256 signature over the method, path and expiry (and, for uploads, the type and size), keyed by the `PHOTO_LINK_KEY` secret. A link that is missing, changed, expired, or used for the other method is refused with `403`.

The upload link accepts only a file of the declared type (JPG, PNG or WebP) and exact size (up to 5 MB): PUT it with that `Content-Type`, and the Worker answers `204`. Save the returned `path` as the profile's `photoPath`; the Firestore rules accept only a path in the member's own `photos/{uid}/` folder. For now members can download only their own photo; admins (NKB-208) and the directory (NKB-601) add their own checks in `getPhotoDownloadUrl`.

Photos are resized in the browser to about 100 KB (NKB-302), so 1,000 members use about 100 MB of KV's free 1 GB. Each upload is one of KV's free 1,000 writes a day, a limit shared by both environments and the backups (NKB-119). KV is eventually consistent: a new photo can take up to a minute to appear outside the place it was uploaded from, so the app should show the file it just uploaded rather than download it again.

Locally, `wrangler dev` keeps photos in its local KV in `worker/.wrangler/`, and signs links with the `PHOTO_LINK_KEY` in `wrangler.jsonc`, so no secret is needed. Without `PHOTO_LINK_KEY`, both endpoints answer `503` ("Photo storage is not configured").

The R2 photo functions from NKB-105 are still in `functions/` and unused; NKB-120 removes them with the rest of the Cloud Functions set-up. Do not set up R2 buckets.

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

Not used: Brevo needs a domain the project does not have, so NKB-116 sends email through the shared Gmail account instead, and this section is replaced then.

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

`schedulerHeartbeat` runs every day at 06:00 and does nothing but succeed. It is temporary: it was meant to check scheduled jobs on staging once. NKB-118 now does that check with the Worker's triggers, and NKB-120 removes the heartbeat.

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

Exports hold Firestore only. Photos are in Workers KV and Auth accounts in Firebase Auth, neither of which this covers.

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
