import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Load root .env if present
const rootEnv = path.resolve(process.cwd(), '../../.env');
const localEnv = path.resolve(process.cwd(), '.env');
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
} else if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

function resolveSecret(envName: string, minHexLen = 64): string {
  const value = process.env[envName];
  if (value && value.length >= minHexLen) {
    return value;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing or weak required secret environment variable: ${envName}`);
  }
  // Safe ephemeral secret for dev/test only (never a hardcoded literal)
  console.warn(
    `[security] ${envName} not set. Generating ephemeral random secret for non-production instance.`
  );
  return crypto.randomBytes(32).toString('hex');
}

export interface AppConfig {
  appMode: 'self-hosted' | 'cloud';
  nodeEnv: string;
  host: string;
  port: number;
  appUrl: string;
  corsOrigin: string;
  databaseUrl: string;
  encryptionKeyHex: string;
  sessionSecret: string;
  storageDriver: 'local' | 's3';
  uploadDir: string;
  aiGatewayApiKey?: string;
  aiGatewayBaseUrl: string;
  defaultChatModel: string;
  defaultEmbeddingModel: string;
  smtp?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  auth0?: {
    domain: string;
    clientId: string;
    audience: string;
  };
  allowMockProvider: boolean;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  return {
    appMode: process.env.APP_MODE === 'cloud' ? 'cloud' : 'self-hosted',
    nodeEnv,
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
    appUrl: process.env.APP_URL ?? 'http://127.0.0.1:3000',
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5173',
    databaseUrl,
    encryptionKeyHex: resolveSecret('ENCRYPTION_KEY', 64),
    sessionSecret: resolveSecret('SESSION_SECRET', 32),
    storageDriver: process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
    uploadDir: path.resolve(process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), '../../data/uploads')),
    aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY || undefined,
    aiGatewayBaseUrl: process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1',
    defaultChatModel: process.env.DEFAULT_CHAT_MODEL || 'tencent/hy4-flash',
    defaultEmbeddingModel: process.env.DEFAULT_EMBEDDING_MODEL || 'alibaba/qwen3-embedding-0.6b',
    smtp: process.env.SMTP_HOST
      ? {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT ?? 587),
          user: process.env.SMTP_USER ?? '',
          pass: process.env.SMTP_PASS ?? '',
          from: process.env.SMTP_FROM ?? 'Askmink <noreply@askmink.local>',
        }
      : undefined,
    auth0:
      process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID
        ? {
            domain: process.env.AUTH0_DOMAIN,
            clientId: process.env.AUTH0_CLIENT_ID,
            audience: process.env.AUTH0_AUDIENCE ?? '',
          }
        : undefined,
    allowMockProvider: nodeEnv === 'test' || process.env.ALLOW_MOCK_AI === 'true',
  };
}
