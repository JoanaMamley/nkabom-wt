# Nkabom app

Angular PWA and Firebase backend (Cloud Functions, Firestore rules) for Nkabom, the WomenTrust alumnae community. One repo holds both. Requirements and backlog are in [docs/](docs/).

## Prerequisites

- Node.js 22.12+ (or 24.x)
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
| CI       | passes only if Frontend and Backend both pass               |

To stop a failing check from being merged, require the **CI** check in the branch protection (or ruleset) for `main`. It is the only check that needs listing, even when later stories add jobs.

To run the same checks locally:

```sh
npm run lint && npm run format:check && npm test -- --watch=false && npm run build \
  && npm run test:functions && npm run build:functions
```

## Configuration and secrets

- `src/environments/environment.development.ts` points the app at the emulators.
- `src/environments/environment.ts` holds the production Firebase web config (filled in by NKB-109). The web config identifies the project and is not a secret.
- Server-side secrets (Cloudflare R2, email provider, Google service account) never go in this repo. `.env*`, key files and service account JSON are git-ignored.

Firestore security rules start as default-deny in `firestore.rules`.
