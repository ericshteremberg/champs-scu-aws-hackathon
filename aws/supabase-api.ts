import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { ApiError } from './types.ts';
import type { SchemaTable, SupabaseProject } from '../lib/providers/types.ts';

const origin = 'https://api.supabase.com';
const secretSchema = z.object({
  clientId: z.string().uuid(), clientSecret: z.string().min(1).max(4096),
  redirectUri: z.string().url(), scopes: z.array(z.string()),
});
export type SupabaseApp = z.infer<typeof secretSchema>;
export type SupabaseTokens = { accessToken: string; refreshToken: string; expiresAt: number };
export const projectRef = z.string().regex(/^[a-z]{20}$/);
const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
export const tableSelection = z.array(z.object({ name: identifier, columns: z.array(identifier).min(1).max(100) }).strict()).min(1).max(30);

export function frontendOrigin() {
  const value = process.env.CAUSALITY_FRONTEND_ORIGIN || '';
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(503, 'The provider callback is not configured.', 'provider_not_configured'); }
  if (url.protocol !== 'https:' || url.origin !== value) throw new ApiError(503, 'The provider callback is not configured.', 'provider_not_configured');
  return value;
}

export async function loadSupabaseApp(): Promise<SupabaseApp> {
  if (!process.env.SUPABASE_OAUTH_SECRET_ARN) throw new ApiError(503, 'Supabase authorization is not configured.', 'provider_not_configured');
  try {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 2 });
    const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.SUPABASE_OAUTH_SECRET_ARN }), { abortSignal: AbortSignal.timeout(4000) });
    const app = secretSchema.parse(JSON.parse(result.SecretString || ''));
    if (app.redirectUri !== `${frontendOrigin()}/api/providers/supabase/callback` || [...app.scopes].sort().join(' ') !== 'database:read projects:read') throw new Error('Invalid configuration');
    return app;
  } catch { throw new ApiError(503, 'Supabase authorization configuration could not be loaded. Contact the workspace operator.', 'provider_not_configured'); }
}

/** Only fixed Supabase endpoints are used. Never forward provider bodies or exception messages. */
async function request(path: string, init: RequestInit): Promise<unknown> {
  try {
    const response = await fetch(origin + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new ApiError(409, 'Supabase authorization expired or was revoked. Disconnect and authorize again.', 'provider_reauthorize');
      if (response.status === 403) throw new ApiError(403, 'Supabase denied this read. Check the project access and approved app permissions.', 'provider_forbidden');
      throw new ApiError(502, 'Supabase could not complete the request. Try again.', 'provider_unavailable');
    }
    if (response.status === 204) return null;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response');
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 256 * 1024) { await reader.cancel(); throw new ApiError(413, 'Supabase returned too much metadata. Narrow the project before connecting.', 'provider_response_limit'); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'Supabase could not complete the request. Try again.', 'provider_unavailable');
  }
}

export async function exchangeSupabaseToken(app: SupabaseApp, fields: Record<string, string>): Promise<SupabaseTokens> {
  const value = await request('/v1/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}` },
    body: new URLSearchParams(fields),
  });
  const parsed = z.object({ access_token: z.string().min(1).max(16000), refresh_token: z.string().min(1).max(16000), expires_in: z.number().int().min(60).max(31536000), token_type: z.literal('Bearer') }).safeParse(value);
  if (!parsed.success) throw new ApiError(502, 'Supabase returned an unsupported authorization response.', 'provider_invalid_response');
  return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 };
}

export async function revokeSupabaseToken(app: SupabaseApp, refreshToken: string) {
  await request('/v1/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken }) });
}

export async function fetchSupabaseProjects(accessToken: string): Promise<SupabaseProject[]> {
  const value = await request('/v1/projects', { headers: { Authorization: `Bearer ${accessToken}` } });
  const result = z.array(z.object({ ref: projectRef, name: z.string().max(200), organization_slug: z.string().min(1).max(200), region: z.string().max(100) })).max(100).safeParse(value);
  if (!result.success) throw new ApiError(502, 'Supabase returned unsupported project metadata.', 'provider_invalid_response');
  return result.data.map(project => ({ ref: project.ref, name: project.name, organization: project.organization_slug, region: project.region }));
}

export async function fetchSupabaseSchema(accessToken: string, ref: string): Promise<SchemaTable[]> {
  if (!projectRef.safeParse(ref).success) throw new ApiError(400, 'Choose a valid Supabase project.');
  // Fixed metadata-only query. No SQL or schema identifiers are accepted from the browser.
  const value = await request(`/v1/projects/${ref}/database/query/read-only`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position LIMIT 1001', parameters: ['public'] }),
  });
  const parsed = z.array(z.object({ table_name: z.string(), column_name: z.string() })).max(1000).safeParse(value);
  if (!parsed.success) throw new ApiError(413, 'This project schema exceeds the supported metadata format or 1,000-column limit.', 'provider_schema_limit');
  const tables = new Map<string, string[]>();
  for (const row of parsed.data) {
    if (!identifier.safeParse(row.table_name).success || !identifier.safeParse(row.column_name).success) continue;
    const columns = tables.get(row.table_name) ?? []; columns.push(row.column_name); tables.set(row.table_name, columns);
  }
  return [...tables].map(([name, columns]) => ({ name, columns }));
}
