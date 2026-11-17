import {
  createPinoLoggerConfig,
  REDACTED_VALUE,
  redactSensitiveFields,
  SENSITIVE_LOG_PATHS,
} from '@common/logging/pino-logger.config';

describe('Structured Logging & Redaction', () => {
  it('redacts sensitive headers, PINs, passwords, secrets, and tokens recursively', () => {
    const sanitized = redactSensitiveFields({
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
      'x-nextsms-gateway-token': 'gw-token-123',
      user: {
        phoneE164: '+255712345678',
        password: 'MySecretPassword',
        pin: '4821',
        smsHmacSecret: 'hmac-key-abc',
      },
      codLedger: {
        buyerConfirmationPin: '1234',
        driverConfirmationPin: '5678',
        expectedCashAmount: 81600,
      },
      tokens: [
        { accessToken: 'acc-1', refreshToken: 'ref-1' },
        { vapidPrivateKey: 'priv-key-1' },
      ],
    });

    expect(sanitized.authorization).toBe(REDACTED_VALUE);
    expect(sanitized['x-nextsms-gateway-token']).toBe(REDACTED_VALUE);
    expect(sanitized.user.phoneE164).toBe('+255712345678');
    expect(sanitized.user.password).toBe(REDACTED_VALUE);
    expect(sanitized.user.pin).toBe(REDACTED_VALUE);
    expect(sanitized.user.smsHmacSecret).toBe(REDACTED_VALUE);
    expect(sanitized.codLedger.buyerConfirmationPin).toBe(REDACTED_VALUE);
    expect(sanitized.codLedger.driverConfirmationPin).toBe(REDACTED_VALUE);
    expect(sanitized.codLedger.expectedCashAmount).toBe(81600);
    expect(sanitized.tokens[0].accessToken).toBe(REDACTED_VALUE);
    expect(sanitized.tokens[0].refreshToken).toBe(REDACTED_VALUE);
    expect(sanitized.tokens[1].vapidPrivateKey).toBe(REDACTED_VALUE);
  });

  it('configures pinoHttp redaction paths and ignores health liveness spam', () => {
    const config = createPinoLoggerConfig('info', 'production');
    const pinoHttp = config.pinoHttp as {
      redact: { paths: string[]; censor: string };
      autoLogging: { ignore: (req: { url?: string }) => boolean };
    };

    expect(pinoHttp.redact.censor).toBe(REDACTED_VALUE);
    expect(pinoHttp.redact.paths).toEqual(expect.arrayContaining(SENSITIVE_LOG_PATHS));
    expect(pinoHttp.autoLogging.ignore({ url: '/api/v1/health' })).toBe(true);
    expect(pinoHttp.autoLogging.ignore({ url: '/api/v1/admin/merchants' })).toBe(false);
  });
});
