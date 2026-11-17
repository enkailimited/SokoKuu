import { Params } from 'nestjs-pino';

export const REDACTED_VALUE = '[REDACTED]';

export const SENSITIVE_LOG_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-nextsms-gateway-token"]',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.pin',
  'req.body.buyerPin',
  'req.body.driverPin',
  'req.body.buyerConfirmationPin',
  'req.body.driverConfirmationPin',
  'req.body.secret',
  'req.body.smsHmacSecret',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.vapidPrivateKey',
  '*.password',
  '*.passwordHash',
  '*.pin',
  '*.buyerPin',
  '*.driverPin',
  '*.buyerConfirmationPin',
  '*.driverConfirmationPin',
  '*.secret',
  '*.smsHmacSecret',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.vapidPrivateKey',
  '*.authorization',
];

const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|x-nextsms-gateway-token|password|passwordhash|pin|buyerpin|driverpin|buyerconfirmationpin|driverconfirmationpin|secret|smshmacsecret|token|refreshtoken|accesstoken|vapidprivatekey)$/i;

export function redactSensitiveFields<T>(input: T): T {
  if (input === null || input === undefined || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveFields(item)) as unknown as T;
  }

  const record = input as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED_VALUE;
    } else if (value !== null && typeof value === 'object') {
      output[key] = redactSensitiveFields(value);
    } else {
      output[key] = value;
    }
  }

  return output as T;
}

export function createPinoLoggerConfig(logLevel = 'info', nodeEnv = 'development'): Params {
  return {
    pinoHttp: {
      level: logLevel,
      redact: {
        paths: SENSITIVE_LOG_PATHS,
        censor: REDACTED_VALUE,
      },
      customProps: () => ({
        service: 'sokokuu-tz-backend',
        environment: nodeEnv,
      }),
      serializers: {
        req(req: {
          id?: string;
          method?: string;
          url?: string;
          headers?: Record<string, unknown>;
        }) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            headers: redactSensitiveFields(req.headers ?? {}),
          };
        },
        res(res: { statusCode?: number }) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
      autoLogging: {
        ignore: (req: { url?: string }) => req.url === '/api/v1/health',
      },
    },
  };
}
