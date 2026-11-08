import { resolve } from 'node:path';
import type { AppConfig, InvestigationMode } from '../shared/types.js';

export interface ServerConfig {
  host: string;
  port: number;
  mode: InvestigationMode;
  awsRegion: string;
  modelId?: string;
  merchantUrl?: string;
  merchantToken?: string;
  archiveBucket?: string;
  accessToken?: string;
  appOrigin?: string;
  secureCookies: boolean;
  databasePath: string;
  demoStepMs: number;
  runTimeoutMs: number;
  maxToolCalls: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST || '127.0.0.1';
  const mode = env.INVESTIGATION_MODE || 'demo';
  if (mode !== 'demo' && mode !== 'bedrock') throw new Error('INVESTIGATION_MODE must be demo or bedrock.');
  if (mode === 'bedrock' && !env.BEDROCK_MODEL_ID) throw new Error('BEDROCK_MODEL_ID is required in bedrock mode.');
  if (Boolean(env.MERCHANT_EVIDENCE_URL) !== Boolean(env.MERCHANT_EVIDENCE_TOKEN)) throw new Error('Set both MERCHANT_EVIDENCE_URL and MERCHANT_EVIDENCE_TOKEN.');
  const exposed = !['127.0.0.1', 'localhost', '::1'].includes(host) || env.NODE_ENV === 'production';
  if (exposed && (!env.APP_ACCESS_TOKEN || env.APP_ACCESS_TOKEN.length < 32)) throw new Error('Set APP_ACCESS_TOKEN to at least 32 characters before binding a public interface or running in production.');
  if (env.MERCHANT_EVIDENCE_URL) {
    const url = new URL(env.MERCHANT_EVIDENCE_URL);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && env.NODE_ENV !== 'production'))) throw new Error('MERCHANT_EVIDENCE_URL must be an HTTPS base URL without credentials, query, or fragment. HTTP is allowed only for local development.');
  }
  const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('A numeric server configuration value is outside its allowed range.');
    return parsed;
  };
  return {
    host, mode, port: integer(env.PORT, 3001, 0, 65535),
    awsRegion: env.AWS_REGION || 'us-east-1', modelId: env.BEDROCK_MODEL_ID,
    merchantUrl: env.MERCHANT_EVIDENCE_URL?.replace(/\/+$/, ''), merchantToken: env.MERCHANT_EVIDENCE_TOKEN,
    archiveBucket: env.S3_EVIDENCE_BUCKET, accessToken: env.APP_ACCESS_TOKEN,
    appOrigin: env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : undefined,
    secureCookies: env.NODE_ENV === 'production',
    databasePath: env.DATABASE_PATH || resolve('.data/casework.sqlite'),
    demoStepMs: integer(env.DEMO_STEP_MS, 500, 0, 5000),
    runTimeoutMs: integer(env.RUN_TIMEOUT_MS, 180000, 1000, 600000),
    maxToolCalls: integer(env.MAX_TOOL_CALLS, 16, 8, 50),
  };
}

export function publicConfig(config: ServerConfig): AppConfig {
  return { name: 'Casework', version: '0.1.0', mode: config.mode, awsRegion: config.awsRegion,
    modelId: config.modelId, merchantConnected: Boolean(config.merchantUrl), archiveEnabled: Boolean(config.archiveBucket), authRequired: Boolean(config.accessToken) };
}
