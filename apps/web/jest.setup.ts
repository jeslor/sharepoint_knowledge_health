import { TextDecoder, TextEncoder } from 'util';
import '@testing-library/jest-dom';

// next/jest doesn't load .env.local for test runs — fixture values so
// modules that read these at import time (msal-config.ts, api/client.ts)
// don't throw during tests. Never real values; tests never make real calls.
// Forced (not `||=`): CI's job-level env (ci.yml, for the typecheck step's
// `next build`) and some local shells already export the real
// NEXT_PUBLIC_ENTRA_CLIENT_ID, which would otherwise leak into these tests
// and fail assertions hardcoded against the 'test-client-id' fixture.
process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID = 'test-client-id';
process.env.NEXT_PUBLIC_API_BASE_URL ||= 'http://localhost:3001';

// jsdom doesn't define these (real browsers and Node's own server runtime
// do) — react-dom/server reads them at module-load time, so any suite that
// renders through it (e.g. simulating Next.js's SSR pass) needs them
// present before that import is ever evaluated, which only a setup file
// running ahead of the test file's own imports can guarantee.
global.TextEncoder ??= TextEncoder as unknown as typeof global.TextEncoder;
global.TextDecoder ??= TextDecoder as unknown as typeof global.TextDecoder;
