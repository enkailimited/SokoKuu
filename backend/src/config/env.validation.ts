import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  TZ: z.literal('Africa/Dar_es_Salaam', {
    errorMap: () => ({
      message: 'TZ must be strictly set to Africa/Dar_es_Salaam',
    }),
  }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((val) => /^postgres(ql)?:\/\/.+/.test(val), {
      message: 'DATABASE_URL must be a valid PostgreSQL connection string',
    }),
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .refine((val) => /^rediss?:\/\/.+/.test(val), {
      message: 'REDIS_URL must start with redis:// or rediss://',
    }),
  RABBITMQ_URL: z
    .string()
    .min(1, 'RABBITMQ_URL is required')
    .refine((val) => /^amqps?:\/\/.+/.test(val), {
      message: 'RABBITMQ_URL must start with amqp:// or amqps://',
    }),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().min(2).default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(2).default('7d'),
  NEXTSMS_WEBHOOK_SHARED_TOKEN: z
    .string()
    .min(16, 'NEXTSMS_WEBHOOK_SHARED_TOKEN must be at least 16 characters'),
  NEXTSMS_API_BASE_URL: z.string().url().default('https://messaging-service.co.tz'),
  NEXTSMS_USERNAME: z.string().optional(),
  NEXTSMS_PASSWORD: z.string().optional(),
  NEXTSMS_SENDER_ID: z.string().min(2).max(11).default('SOKOKUU'),
  SECURITY_ADMIN_ALERT_PHONE: z
    .string()
    .regex(/^\+255[67][0-9]{8}$/)
    .optional(),
  QR_TOKEN_HMAC_SECRET: z.string().min(16).optional(),
  QR_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  VAPID_SUBJECT: z.string().min(5).default('mailto:ops@sokokuu.tz'),
  VAPID_PUBLIC_KEY: z.string().min(16, 'VAPID_PUBLIC_KEY is required'),
  VAPID_PRIVATE_KEY: z.string().min(16, 'VAPID_PRIVATE_KEY is required'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173,https://sokokuu.tz'),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const normalized: Record<string, unknown> = {
    ...config,
    TZ: config.TZ ?? process.env.TZ ?? 'Africa/Dar_es_Salaam',
  };

  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'ENV'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Startup environment validation failed: ${details}`);
  }

  return parsed.data;
}
