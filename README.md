# Nkabom frontend

Angular PWA for Nkabom, the WomenTrust alumnae community. Requirements and backlog are in [docs/](docs/).

## Prerequisites

- Node.js 22.12+ (or 24.x)
- Java 11+ (needed by the Firestore emulator)

## Getting started

```sh
npm install
npm start
```

`npm start` runs the Firebase Emulator Suite (Auth and Firestore) and the Angular dev server together:

| Service     | URL                   |
| ----------- | --------------------- |
| App         | http://localhost:4200 |
| Emulator UI | http://127.0.0.1:4000 |
| Auth        | http://127.0.0.1:9099 |
| Firestore   | http://127.0.0.1:8080 |

Local work uses the `demo-nkabom` project ID, so no Firebase login or credentials are needed. Emulator data is saved to `.emulator-data/` on exit and reloaded on the next start; delete the folder to start fresh.

## Scripts

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm start`            | Emulators plus dev server                 |
| `npm run serve`        | Dev server only                           |
| `npm run emulators`    | Emulators only                            |
| `npm test`             | Unit tests (Vitest)                       |
| `npm run lint`         | ESLint (TypeScript and templates)         |
| `npm run format`       | Format with Prettier                      |
| `npm run format:check` | Check formatting without writing          |
| `npm run build`        | Production build to `dist/nkabom/browser` |

## Configuration and secrets

- `src/environments/environment.development.ts` points the app at the emulators.
- `src/environments/environment.ts` holds the production Firebase web config (filled in by NKB-109). The web config identifies the project and is not a secret.
- Server-side secrets (Cloudflare R2, email provider, Google service account) never go in this repo. `.env*`, key files and service account JSON are git-ignored.

Firestore security rules start as default-deny in `firestore.rules`.
