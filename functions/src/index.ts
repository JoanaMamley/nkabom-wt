import { initializeApp } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';

initializeApp();

// Placeholder so the Functions emulator has something to load.
// Replaced by real functions starting with NKB-104 (audit log) and NKB-208 (roles).
export const ping = onRequest((_request, response) => {
  response.json({ ok: true });
});
