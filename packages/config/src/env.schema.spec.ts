import { parseEnv, validateEnvOrExit } from './env.schema';

const validEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  ENTRA_CLIENT_ID: 'client-id',
  ENTRA_CLIENT_SECRET: 'client-secret',
};

function withoutKey(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(validEnv).filter(([k]) => k !== key));
}

describe('parseEnv', () => {
  it('parses a fully valid environment', () => {
    const result = parseEnv(validEnv);
    expect(result).toEqual(validEnv);
  });

  it('defaults NODE_ENV to development when omitted', () => {
    const result = parseEnv(withoutKey('NODE_ENV'));
    expect(result.NODE_ENV).toBe('development');
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'])(
    'throws when %s is missing',
    (key) => {
      expect(() => parseEnv(withoutKey(key))).toThrow();
    },
  );

  it('throws when DATABASE_URL is not a valid URL', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow();
  });
});

describe('validateEnvOrExit', () => {
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns the parsed env on success without exiting', () => {
    const result = validateEnvOrExit(validEnv);
    expect(result).toEqual(validEnv);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('logs a clear, per-field error and exits(1) — never a raw stack trace — on invalid config', () => {
    validateEnvOrExit(withoutKey('DATABASE_URL'));

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
  });
});
