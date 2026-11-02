// The Firebase web config is kept out of the repo (README, Configuration and secrets), so automated
// deploys (NKB-121) write it into the app before building, from the FIREBASE_WEB_CONFIG secret of
// the GitHub environment, and the privacy notice's contact address (FR-1.14) from its PRIVACY_CONTACT
// variable.
//
//   node scripts/write-environment.mjs staging       # writes src/environments/environment.staging.ts
//   node scripts/write-environment.mjs production    # writes src/environments/environment.ts
//
// FIREBASE_WEB_CONFIG is the config as JSON. To make it, print your local copy, which holds the real
// values, and paste the output into the secret:
//
//   node scripts/write-environment.mjs staging --print
import { readFileSync, writeFileSync } from 'node:fs';

// apiUrl is each environment's Worker (README, Worker). It is not secret, so it is set here.
const TARGETS = {
  staging: {
    file: 'src/environments/environment.staging.ts',
    projectId: 'nkabom-staging',
    apiUrl: 'https://nkabom-api-staging.nkabomwt-project.workers.dev',
  },
  production: {
    file: 'src/environments/environment.ts',
    projectId: 'nkabom-prod',
    apiUrl: 'https://nkabom-api-prod.nkabomwt-project.workers.dev',
  },
};
const FIELDS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

const [name, flag] = process.argv.slice(2);
const target = TARGETS[name];
if (!target) {
  fail(`Usage: node scripts/write-environment.mjs <${Object.keys(TARGETS).join('|')}> [--print]`);
}

if (flag === '--print') {
  // The values in the local file, as JSON for the secret.
  const source = readFileSync(target.file, 'utf8');
  const config = Object.fromEntries(
    FIELDS.map((field) => [field, source.match(new RegExp(`${field}: '([^']*)'`))?.[1] ?? '']),
  );
  check(config);
  console.log(JSON.stringify(config));
} else {
  let config;
  try {
    config = JSON.parse(process.env.FIREBASE_WEB_CONFIG ?? '');
  } catch {
    fail('FIREBASE_WEB_CONFIG is not set, or is not JSON');
  }
  check(config);
  const privacyContact = process.env.PRIVACY_CONTACT ?? '';
  // Kept out of the repo like the web config (docs/handbook/accounts.md), but the notice must name
  // someone, so a deploy without it stops here.
  if (!/^[^\s@]+@[^\s@]+$/.test(privacyContact)) {
    fail('PRIVACY_CONTACT is not set, or is not an email address');
  }
  writeFileSync(target.file, environmentFile(config, privacyContact));
  console.log(`Wrote ${target.file} for ${config.projectId}`);
}

// Every field filled in, and for the right project, so a mixed-up secret cannot point the
// production app at staging.
function check(config) {
  const missing = FIELDS.filter((field) => typeof config[field] !== 'string' || !config[field]);
  // storageBucket and messagingSenderId are unused, and may be empty.
  const needed = missing.filter((field) => !['storageBucket', 'messagingSenderId'].includes(field));
  if (needed.length > 0) {
    fail(`The ${name} web config has no ${needed.join(', ')}`);
  }
  if (config.projectId !== target.projectId) {
    fail(`The ${name} web config is for ${config.projectId}, not ${target.projectId}`);
  }
}

function environmentFile(config, privacyContact) {
  const fields = FIELDS.map((field) => `    ${field}: ${JSON.stringify(config[field] ?? '')},`);
  return [
    "import { Environment } from './environment.model';",
    '',
    `// Written by scripts/write-environment.mjs for the ${name} deploy. Not committed.`,
    'export const environment: Environment = {',
    '  production: true,',
    `  privacyContact: ${JSON.stringify(privacyContact)},`,
    `  apiUrl: ${JSON.stringify(target.apiUrl)},`,
    '  firebase: {',
    ...fields,
    '  },',
    '};',
    '',
  ].join('\n');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
