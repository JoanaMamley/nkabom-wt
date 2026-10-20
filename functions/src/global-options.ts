import { setGlobalOptions } from 'firebase-functions/v2';

// Cost guardrail (NKB-112): no function scales past 10 instances, so a bug or a flood of
// requests cannot run up the bill. Functions read these options when they are defined, so
// index.ts imports this file before any function.
setGlobalOptions({ maxInstances: 10 });
