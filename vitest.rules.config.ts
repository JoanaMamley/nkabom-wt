import { defineConfig } from 'vitest/config';

// Firestore security rules tests. They need the emulator, so run them with npm run test:rules
// rather than ng test.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Tests share one emulator database and clear it between tests.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
