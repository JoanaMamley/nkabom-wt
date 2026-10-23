// First, so the global options apply to every function below.
import './global-options';

import { initializeApp } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';

initializeApp();

export { backupFirestore } from './backups';
export { schedulerHeartbeat } from './scheduled';
export { enforceBudget } from './costs';
export { getPhotoDownloadUrl, getPhotoUploadUrl } from './photos';

// Placeholder so the Functions emulator has something to load.
// Replaced by real functions starting with NKB-104 (audit log) and NKB-208 (roles).
export const ping = onRequest((_request, response) => {
  response.json({ ok: true });
});
