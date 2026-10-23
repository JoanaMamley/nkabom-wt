// The data model moved to the Worker in NKB-117 (worker/src/model.ts). Only the R2 photo
// functions still use these, until NKB-120 removes them.

// FR-2.3: accepted photo types with the file extension each is stored under, and the size limit.
export const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
export type PhotoType = keyof typeof PHOTO_TYPES;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
