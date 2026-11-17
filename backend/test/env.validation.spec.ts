import { validateEnv } from '@config/env.validation';

describe('Startup Environment Validation (validateEnv)', () => {
  const validEnv: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '3001',
    TZ: 'Africa/Dar_es_Salaam',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://sokokuu:secret@localhost:5432/sokokuu_tz?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    RABBITMQ_URL: 'amqp://sokokuu:secret@localhost:5672',
    JWT_ACCESS_SECRET: 'a_very_secure_access_secret_with_at_least_32_characters',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_SECRET: 'a_very_secure_refresh_secret_with_at_least_32_characters',
    JWT_REFRESH_EXPIRES_IN: '7d',
    NEXTSMS_WEBHOOK_SHARED_TOKEN: 'nextsms_gateway_secret_token_1234',
    VAPID_SUBJECT: 'mailto:ops@sokokuu.tz',
    VAPID_PUBLIC_KEY: 'BOr7_valid_vapid_public_key_placeholder_123456',
    VAPID_PRIVATE_KEY: 'valid_vapid_private_key_placeholder_123456',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://sokokuu.tz',
  };

  it('accepts a complete valid environment configuration', () => {
    const validated = validateEnv(validEnv);
    expect(validated.TZ).toBe('Africa/Dar_es_Salaam');
    expect(validated.PORT).toBe(3001);
    expect(validated.DATABASE_URL).toContain('postgresql://');
  });

  it('fails fast when TZ is not Africa/Dar_es_Salaam', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        TZ: 'UTC',
      }),
    ).toThrow(/TZ must be strictly set to Africa\/Dar_es_Salaam/);
  });

  it('fails fast when JWT secrets are too short or missing', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        JWT_ACCESS_SECRET: 'short',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('fails fast when required infrastructure URLs or tokens are missing', () => {
    const {
      DATABASE_URL: _db,
      REDIS_URL: _redis,
      RABBITMQ_URL: _rmq,
      NEXTSMS_WEBHOOK_SHARED_TOKEN: _sms,
      VAPID_PUBLIC_KEY: _vp,
      ...incomplete
    } = validEnv;

    expect(() => validateEnv(incomplete)).toThrow(/Startup environment validation failed/);
  });
});
