import '@testing-library/jest-dom';

// next/jest doesn't load .env.local for test runs — fixture values so
// modules that read these at import time (msal-config.ts, api/client.ts)
// don't throw during tests. Never real values; tests never make real calls.
process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ||= 'test-client-id';
process.env.NEXT_PUBLIC_API_BASE_URL ||= 'http://localhost:3001';
