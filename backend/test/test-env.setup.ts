process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '3001';
process.env.TZ = 'Africa/Dar_es_Salaam';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://sokokuu:secret@localhost:5432/sokokuu_tz?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://sokokuu:secret@localhost:5672';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'a_very_secure_access_secret_with_at_least_32_characters';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'a_very_secure_refresh_secret_with_at_least_32_characters';
process.env.NEXTSMS_WEBHOOK_SHARED_TOKEN =
  process.env.NEXTSMS_WEBHOOK_SHARED_TOKEN || 'nextsms_gateway_secret_token_1234';
process.env.VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || 'BOr7_valid_vapid_public_key_placeholder_123456';
process.env.VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || 'valid_vapid_private_key_placeholder_123456';
process.env.CORS_ALLOWED_ORIGINS =
  process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,https://sokokuu.tz';
