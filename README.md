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
- `docs/` requirements and backlog

## Scripts

| Command                   | What it does                                  |
| ------------------------- | --------------------------------------------- |
| `npm start`               | Emulators plus dev server                     |
| `npm run serve`           | Dev server only                               |
| `npm run emulators`       | Builds functions, then runs emulators only    |
| `npm run build:functions` | Compile Cloud Functions                       |
| `npm test`                | App unit tests (Vitest)                       |
| `npm run test:functions`  | Cloud Functions tests (Vitest)                |
| `npm run test:rules`      | Firestore security rules tests (emulator)     |
| `npm run lint`            | ESLint (TypeScript and templates)             |
| `npm run format`          | Format with Prettier                          |
| `npm run format:check`    | Check formatting without writing              |
| `npm run build`           | Production build to `dist/nkabom-app/browser` |

## Continuous integration

GitHub Actions runs [.github/workflows/ci.yml](.github/workflows/ci.yml) on every pull request and on every push to `main`:

| Job      | Runs                                                        |
| -------- | ----------------------------------------------------------- |
| Frontend | `ng lint`, Prettier check, app unit tests, production build |
| Backend  | functions lint, Prettier check, functions tests, build      |
| Rules    | Firestore security rules tests against the emulator         |
| CI       | passes only if every job above passes                       |

To stop a failing check from being merged, require the **CI** check in the branch protection (or ruleset) for `main`. It is the only check that needs listing, even when later stories add jobs.

To run the same checks locally:

```sh
npm run lint && npm run format:check && npm test -- --watch=false && npm run build \
  && npm run test:functions && npm run build:functions && npm run test:rules
```

## Configuration and secrets

- `src/environments/environment.development.ts` points the app at the emulators.
- `src/environments/environment.ts` holds the production Firebase web config (filled in by NKB-109). The web config identifies the project and is not a secret.
- Server-side secrets (Cloudflare R2, email provider, Google service account) never go in this repo. `.env*`, `.secret.local`, key files and service account JSON are git-ignored.
- `functions/.env.demo-nkabom` holds the non-secret Functions settings for the emulators, so they start without prompting. It is the one committed `.env` file; never put secrets in it.

## Photo storage (Cloudflare R2)

Photos live in a private R2 bucket. The browser never gets the bucket's keys: it calls a Cloud Function for a short-lived signed link and uploads or downloads with that.

| Function              | Takes                   | Returns                                                      |
| --------------------- | ----------------------- | ------------------------------------------------------------ |
| `getPhotoUploadUrl`   | `{ contentType, size }` | `{ url, path, expiresIn }`: a 5-minute PUT link and the path |
| `getPhotoDownloadUrl` | `{ path }`              | `{ url, expiresIn }`: a 10-minute GET link                   |

The upload link accepts only a file of the declared type (JPG, PNG or WebP) and exact size (up to 5 MB): PUT it with that `Content-Type`. Save the returned `path` as the profile's `photoPath`; the Firestore rules accept only a path in the member's own `photos/{uid}/` folder. For now members can download only their own photo.

Without R2 settings the emulators still run, and both functions answer `failed-precondition` ("Photo storage is not configured").

### Setting up a bucket

Once per Firebase project (staging and production), in the executives' Cloudflare account:

1. **R2 > Create bucket**, for example `nkabom-photos`. Leave public access off (no r2.dev URL, no custom domain), so files open only through signed links.
2. In the bucket's **Settings > CORS policy**, allow the app to upload and download:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:4200", "https://<app domain>"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **R2 > Manage API tokens > Create API token** with **Object Read & Write**, limited to this bucket. Note the access key ID and secret access key; the secret is shown once.
4. Store the values in the Firebase project (the account ID is on the R2 overview page):

   ```sh
   firebase functions:secrets:set R2_ACCOUNT_ID
   firebase functions:secrets:set R2_ACCESS_KEY_ID
   firebase functions:secrets:set R2_SECRET_ACCESS_KEY
   ```

   The first deploy asks for `R2_BUCKET` (default `nkabom-photos`).

To use a real bucket from the emulators, put the three values in `functions/.secret.local` (git-ignored) as `NAME=value` lines.

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

Brevo's free plan sends up to 300 emails a day. Once per Firebase project (staging and production):

1. Create a Brevo account with the shared project Google account (NKB-113).
2. **Senders, domains and dedicated IPs > Domains**: add the sending domain and add the DNS records Brevo shows (DKIM, DMARC, and the Brevo code), so mail is not marked as spam.
3. **SMTP & API > API keys**: create a key, then run `firebase functions:secrets:set BREVO_API_KEY`.
4. The first deploy asks for `EMAIL_FROM`, an address on that domain.

## Data model

Types and collection names live in [functions/src/model.ts](functions/src/model.ts). [firestore.rules](firestore.rules) validates the same shapes, so change the two together.

| Collection      | Document ID | Holds                                                                 | Written by                                    |
| --------------- | ----------- | --------------------------------------------------------------------- | --------------------------------------------- |
| `users/{uid}`   | Auth UID    | Role: `member`, `admin` or `primaryAdmin`                             | Cloud Functions only                          |
| `members/{uid}` | Auth UID    | Profile, and status: `pending`, `active`, `rejected` or `deactivated` | The member creates it, as pending             |
| `auditLog/{id}` | Auto ID     | Admin actions: actor, action, target, time                            | Cloud Functions only, never edited or deleted |

To record an admin action from a Cloud Function, call `recordAudit` from [functions/src/audit.ts](functions/src/audit.ts):

```ts
await recordAudit(request.auth, 'registration.approve', { type: 'member', id: uid });
```

Using the user ID as the document ID means a user can have only one profile: the rules deny a second write. The `createUserRecord` function writes a `member` record for every new account. Anything the rules do not open is denied (FR-1.12). The rules tests in `tests/` start each case from an empty emulator database.
