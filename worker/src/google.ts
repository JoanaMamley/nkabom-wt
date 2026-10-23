import { importPKCS8, SignJWT } from 'jose';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

// cloud-platform covers Firestore and Firebase Auth. Add a scope here when a story needs another
// API, such as Calendar (NKB-501).
const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Tokens last an hour. Each Worker instance keeps its own until 5 minutes before it expires.
let cached: { email: string; token: string; expiresAt: number } | undefined;

// An OAuth access token for the service account, from a JWT signed with its key.
export async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const account = JSON.parse(serviceAccountJson) as ServiceAccount;
  if (cached?.email === account.client_email && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached.token;
  }
  const key = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: SCOPES.join(' ') })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
  }
  const { access_token, expires_in } = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = {
    email: account.client_email,
    token: access_token,
    expiresAt: Date.now() + expires_in * 1000,
  };
  return access_token;
}
