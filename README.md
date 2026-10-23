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
5. Skip: photos and email no longer need Functions secrets. They use the Worker's secrets (see [Setting up the Worker](#setting-up-the-worker) and [Setting up Gmail](#setting-up-gmail)).
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

Every endpoint except `/health` and the signed photo links starts with `requireAccount` from [worker/src/users.ts](worker/src/users.ts), so admin routes are enforced on the server, not only hidden in the app (FR-1.11). It checks the caller's Firebase ID token (`requireUser` in [worker/src/auth.ts](worker/src/auth.ts)): the token must be signed by Google, issued for that environment's project, unexpired, and name a user; otherwise the answer is `401`. It then reads the caller's `users/{uid}` record for their role, and on a new account's first call creates that record as `member` (FR-1.5), so the app calls `GET /v1/me` straight after sign-up and every sign-in. The Worker reaches Firestore through its REST API, as the project's service account, which bypasses the Firestore rules the way the Admin SDK does.

| Endpoint                | Needs sign-in | Takes                      | Returns                                                      |
| ----------------------- | ------------- | -------------------------- | ------------------------------------------------------------ |
| `GET /health`           | No            |                            | `{ ok: true }`                                               |
| `GET /v1/me`            | Yes           |                            | `{ uid, role }`, creating the `users` record on a first call |
| `POST /v1/registration` | Yes           | Every profile detail       | `201` `{ status: "pending" }` (see [Profiles](#profiles))    |
| `PATCH /v1/profile`     | Yes           | Any of the profile details | `204`                                                        |

The photo endpoints are listed under [Photo storage](#photo-storage), and the admin test email under [Email](#email).

Send the token as `Authorization: Bearer <ID token>`. Errors come back as `{ error }` with the status; an unexpected failure is a `500` whose details go only to the Worker's log, as `Request failed`.

**CORS:** only the origins in `ALLOWED_ORIGINS` (the app's `web.app` and `firebaseapp.com` addresses, and `localhost:4200` locally) get CORS headers, for `GET`, `POST`, `PUT`, `PATCH` and `DELETE` with `Authorization` and `Content-Type`. Add a custom domain there if the app later gets one.

**Adding an endpoint:** add a case to `route` in [worker/src/index.ts](worker/src/index.ts), call `requireAccount` first (and `requireAdmin` from [worker/src/roles.ts](worker/src/roles.ts) for admin endpoints), and throw `HttpError` for answers such as `400` or `403`. Firestore helpers are in [worker/src/firestore.ts](worker/src/firestore.ts): `getDocument` for a single read, and `runTransaction` for any change, which reads with `tx.getAll`, adds writes with `tx.create`, `set`, `update` and `delete` (`SERVER_TIME` as a value stores the commit time), and commits them all or none. Firestore runs the function again if the transaction clashes with another, so keep side effects such as email outside it.

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
| Email settings and secrets    |         | See [Email](#email)                                                                              |

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

The answer is `{"uid":"…","role":"member"}`, and the first call creates the account's `users` record, which the Emulator UI then shows. Without the header the answer is `401`.

Tests run inside the Workers runtime with `@cloudflare/vitest-plugin` (`npm run test:worker`). They stand in for Google's keys, token exchange and Firestore, so they need no network or emulators. Firestore is played by [worker/src/fake-firestore.ts](worker/src/fake-firestore.ts), which answers reads, transactions and commits the way the emulator does; use `mockEmulators()` from `test-helpers.ts` in a test that signs in.

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
4. Change one character in the middle of the token's signature, the part after the last `.`, and call again:

   ```sh
   SIG=${TOKEN##*.}; MID=$(( ${#SIG} / 2 ))
   C=A; [ "${SIG:$MID:1}" = A ] && C=B
   curl -s $API/v1/me -H "Authorization: Bearer ${TOKEN%.*}.${SIG:0:$MID}$C${SIG:$((MID + 1))}"
   ```

   It answers `401` `{"error":"Invalid or expired sign-in"}`. Do not change the last character instead: it holds only 2 bits of the signature, so a swap can leave the signature the same and the token valid.

5. `curl -s $API/v1/me -H "Authorization: Bearer $TOKEN"` answers `{"uid":"<User UID>","role":"member"}`.
6. In **Firestore Database**, the `users` collection now has a document with the User UID as its ID, `role` `member` and the test address, written by the Worker through the service account. Leave the user and document in place as data for the restore test (NKB-119).
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

The upload link accepts only a file of the declared type (JPG, PNG or WebP) and exact size (up to 5 MB): PUT it with that `Content-Type`, and the Worker answers `204`. Send the returned `path` as `photoPath` to `POST /v1/registration` or `PATCH /v1/profile`, which accept only a photo already uploaded to the member's own `photos/{uid}/` folder. For now members can download only their own photo; admins (NKB-208) and the directory (NKB-601) add their own checks in `getPhotoDownloadUrl`.

Photos are resized in the browser to about 100 KB (NKB-302), so 1,000 members use about 100 MB of KV's free 1 GB. Each upload is one of KV's free 1,000 writes a day, a limit shared by both environments and the backups (NKB-119). KV is eventually consistent: a new photo can take up to a minute to appear outside the place it was uploaded from, so the app should show the file it just uploaded rather than download it again.

Locally, `wrangler dev` keeps photos in its local KV in `worker/.wrangler/`, and signs links with the `PHOTO_LINK_KEY` in `wrangler.jsonc`, so no secret is needed. Without `PHOTO_LINK_KEY`, both endpoints answer `503` ("Photo storage is not configured").

The R2 photo functions from NKB-105 are still in `functions/` and unused; NKB-120 removes them with the rest of the Cloud Functions set-up. Do not set up R2 buckets.

## Email

The Worker sends every email through `sendEmail` in [worker/src/email.ts](worker/src/email.ts), using a template from [worker/src/email-templates.ts](worker/src/email-templates.ts), the one place email wording lives (FR-8.5):

```ts
await sendEmail(env, { email, name }, 'registrationApproved', { firstName, appUrl });
```

Each template gives its text once, and both the plain-text and HTML versions are built from it, with typed-in values escaped. To add an email, add a template there; TypeScript then checks every caller's data.

A failed send is logged as `Email send failed`, with the provider, template, recipient and error but not the body, since that may hold a one-time link. The error is then thrown, so the caller can retry or fall back.

| Setting              | Kind    | Value                                                                        |
| -------------------- | ------- | ---------------------------------------------------------------------------- |
| `EMAIL_PROVIDER`     | setting | `gmail` (deployed Workers), `log` (local), or `brevo`                        |
| `EMAIL_FROM_NAME`    | setting | Sender name (default `Nkabom`)                                               |
| `APP_URL`            | setting | The app's address, for links in emails                                       |
| `GMAIL_USER`         | secret  | The shared project account's Gmail address, which every email is sent from   |
| `GMAIL_APP_PASSWORD` | secret  | An app password for that account (see [Setting up Gmail](#setting-up-gmail)) |
| `EMAIL_FROM`         | setting | Brevo only: sender address, on a domain verified with Brevo                  |
| `BREVO_API_KEY`      | secret  | Brevo only                                                                   |

The settings are in [worker/wrangler.jsonc](worker/wrangler.jsonc). The Gmail address is a secret rather than a setting only to keep account details out of the repo; recipients see it as the sender.

Locally, `EMAIL_PROVIDER` is `log`, so nothing is sent: emails, links included, are printed in the `wrangler dev` output. Never use `log` in a deployed Worker.

To switch provider, change `EMAIL_PROVIDER`; to add one, add a function for it in [worker/src/email-providers.ts](worker/src/email-providers.ts) and a case in `email.ts`. Callers and templates do not change.

**Test email:** `POST /v1/email/test`, for admins only, sends the `testNotification` email to the caller's own address and answers `{ sentTo }`, or `502` if sending failed. It checks the whole set-up, and is the endpoint behind the "send a test notification" button (FR-4.14).

### Gmail

The `gmail` provider sends through Gmail's mail server, `smtp.gmail.com` on port 465 over TLS, signed in as the shared project account with an app password. No domain or email service is needed. It uses the Workers TCP sockets API ([worker/src/smtp.ts](worker/src/smtp.ts)), which allows every port but 25, and builds the message itself ([worker/src/mime.ts](worker/src/mime.ts)).

**Daily limit:** Google allows a personal Gmail account about 500 emails a day, over a rolling 24 hours ([Gmail sending limits](https://support.google.com/mail/answer/22839)), and staging and production share the account. Large sends, such as the yearly profile reminder (FR-2.5), send at most `BULK_EMAILS_PER_DAY` (100) a day, so 1,000 members take 10 days, and approvals, invites and alerts keep room. Past the limit Gmail refuses with `550 5.4.5`, which shows in the `Email send failed` log, and sending resumes within a day.

### Setting up Gmail

Once per environment, signed in to the shared project Google account. Each environment gets its own app password, so one can be revoked without the other.

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). It needs 2-Step Verification, which the account has (see [docs/handbook/account-setup.md](docs/handbook/account-setup.md)). Google may ask for the password again.
2. Enter a name, `Nkabom staging` (or `Nkabom production`), and click **Create**. Google shows a 16-letter password once.
3. Straight away, in `worker/`, set it and the account's address as secrets. Each command asks for the value; paste it and press Enter:

   ```sh
   npx wrangler secret put GMAIL_APP_PASSWORD --env staging
   npx wrangler secret put GMAIL_USER --env staging
   ```

   Then close the Google page. The secret is the only copy; Google never shows the password again.

4. Deploy the Worker (`npm --prefix worker run deploy:staging`), and check it with the test email: in Firestore, give a test user the `admin` role in `users/{uid}`, then call `POST /v1/email/test` with that user's ID token, as in [Checking staging](#checking-staging). The email arrives from the shared account's address.

**Spam folder:** Gmail signs every message, so SPF, DKIM and DMARC all pass (checked on staging with **Show original**). Even so, a new account that has sent little has no reputation yet, and its early emails can land in spam. It improves as the account sends steady, small amounts that people open and do not mark as spam. To help, the registration-approved email asks each member to add the sender to their contacts, since Gmail rarely sends mail from a contact to spam; test inboxes should mark it **Not spam**. Sending from the project's own domain would fix it, but needs a paid domain.

**Changing the account's password cancels every app password,** and email stops with `535` (`Username and Password not accepted`) in the `Email send failed` log. After a password change, make a new app password for each environment as above and set `GMAIL_APP_PASSWORD` again; no deploy is needed. Delete old app passwords from the same page.

### Brevo

An alternative only: Brevo needs a sending domain the project does not have. Its free plan sends up to 300 emails a day. To use it:

1. Create a Brevo account with the shared project Google account, add the sending domain under **Settings > Senders, domains, IPs > Domains**, and add the DNS records Brevo shows.
2. Under **Settings > Security > Authorized IPs**, turn IP blocking off: the Worker sends from changing addresses.
3. Per environment, under **SMTP & API > API keys**, create a key named after it, and set it with `npx wrangler secret put BREVO_API_KEY --env staging` (or `production`).
4. In `wrangler.jsonc`, set `EMAIL_PROVIDER` to `brevo` and `EMAIL_FROM` to an address on the domain, then deploy.

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

Types and collection names live in [worker/src/model.ts](worker/src/model.ts). Only the Worker writes these collections; [firestore.rules](firestore.rules) lets the app read what each person may see and denies every write from the app.

| Collection        | Document ID | Holds                                                                                   | Written by                                                      |
| ----------------- | ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `users/{uid}`     | Auth UID    | Role: `member`, `admin` or `primaryAdmin`                                               | The Worker, on the account's first call                         |
| `members/{uid}`   | Auth UID    | Profile, and status: `pending`, `active`, `rejected` or `deactivated`                   | The Worker: registration, profile edits and status changes      |
| `directory/{uid}` | Auth UID    | Limited profile of an active member: name, photo, course or occupation, graduation year | The Worker, in the same transaction as each `members` change    |
| `auditLog/{id}`   | Auto ID     | Admin actions: actor, action, target, time                                              | The Worker, with the action it records; never edited or deleted |

Using the user ID as the document ID means a user can have only one profile (FR-2.6). Anything the rules do not open is denied (FR-1.12). The rules tests in `tests/` start each case from an empty emulator database.

### Profiles

Members register and edit their details only through the Worker ([worker/src/members.ts](worker/src/members.ts)), which checks every field (FR-2.2), so the checks cannot be skipped by writing to Firestore directly:

- **`POST /v1/registration`** takes `firstNames`, `surname`, `dateOfBirth` (`YYYY-MM-DD`), `stage` (`student` or `graduate`), `courseOrOccupation`, `graduationYear` and `photoPath`, all required. It creates `members/{uid}` as `pending` with server times for `createdAt` and `updatedAt`, and answers `409` if the member has already registered.
- **`PATCH /v1/profile`** takes any of the same fields and changes only those, setting `updatedAt` (FR-2.4, FR-2.5). An empty body `{}` changes nothing but `updatedAt`, for a member confirming their details are still right. Pending and active members can edit; a rejected or deactivated member gets `403`, and a caller with no profile `404`.

Both refuse any other field, such as `status` or `createdAt`, with `400`. Text is trimmed and must be 1 to 100 characters; the date of birth must be a real date in the past, from 1900; the graduation year a whole number from 1990 to the current year + 8; and the photo one uploaded to the member's own folder. A refused request answers `400` with an `error` saying what to fix.

### Full records and the directory

A member's full record, with date of birth and status, stays in `members/{uid}`, which only that member can read (and admins, from NKB-208). Other members see only `directory/{uid}`, which holds the FR-5.2 fields and nothing else (FR-3.1).

`syncDirectory` in [worker/src/directory.ts](worker/src/directory.ts) runs in the same transaction as every change to a profile, so the two are saved together or not at all. It lists a member once their status is `active`, copies changes to the listed fields, and removes the entry when the member is no longer active or the profile is deleted. Only active members can read the directory, so pending members see nothing (FR-2.9).

Code that changes a profile, such as approval (NKB-307) or deactivation, reads it with `readMember` and writes with `changeProfile` from `members.ts`, which updates the directory too:

```ts
await runTransaction(env, async (tx) => {
  const { profile, listed } = await readMember(tx, uid);
  changeProfile(tx, uid, profile!, listed, { status: 'active' });
  recordAudit(tx, admin, 'registration.approve', { type: 'member', id: uid });
});
```

To show another field to members, add it to `DIRECTORY_FIELDS` in `model.ts` and check FR-5.2 and the privacy notice first. Date of birth and contact details must never be added.

### Audit log

To record an admin action, call `recordAudit` from [worker/src/audit.ts](worker/src/audit.ts) in the transaction that makes the change, as above, so the action is never saved without its entry. It takes the admin's account from `requireAccount` and copies their name and email into the entry. For an action that changes nothing else, such as an export, use a transaction of its own:

```ts
await runTransaction(env, async (tx) => recordAudit(tx, admin, 'members.export', null));
```
