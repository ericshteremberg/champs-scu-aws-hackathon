import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ secret: vi.fn() }));
vi.mock('@aws-sdk/client-secrets-manager', () => ({ SecretsManagerClient: class { send = mocks.secret; }, GetSecretValueCommand: class { constructor(public input: unknown) {} } }));
import { exchangeSupabaseToken, fetchSupabaseProjects, fetchSupabaseSchema, loadSupabaseApp, revokeSupabaseToken } from '../aws/supabase-api.ts';
const app = { clientId: '708982e7-e164-45b1-b230-7f3d1d2cf48b', clientSecret: 'synthetic_app_secret', redirectUri: 'https://dev.example.test/api/providers/supabase/callback', scopes: ['projects:read', 'database:read'] };
const http = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal('fetch', http); http.mockReset(); mocks.secret.mockReset();
  process.env.SUPABASE_OAUTH_SECRET_ARN = 'synthetic-secret-arn'; process.env.CAUSALITY_FRONTEND_ORIGIN = 'https://dev.example.test';
  mocks.secret.mockResolvedValue({ SecretString: JSON.stringify(app) });
});
afterEach(() => vi.unstubAllGlobals());
describe('Supabase network boundary', () => {
  it('loads the registered secret by ARN and rejects broader scopes or a different callback', async () => {
    expect(await loadSupabaseApp()).toEqual(app);
    expect(mocks.secret.mock.calls[0][0].input).toEqual({ SecretId: 'synthetic-secret-arn' });
    for (const change of [{ scopes: ['all'] }, { redirectUri: 'https://untrusted.test/callback' }]) {
      mocks.secret.mockResolvedValueOnce({ SecretString: JSON.stringify({ ...app, ...change }) });
      await expect(loadSupabaseApp()).rejects.toMatchObject({ code: 'provider_not_configured' });
    }
  });
  it('exchanges code using Basic app authentication and returns only typed credentials', async () => {
    http.mockResolvedValue(Response.json({ access_token: 'fictional_access', refresh_token: 'fictional_refresh', expires_in: 3600, token_type: 'Bearer', secret_extra: 'discard' }));
    const result = await exchangeSupabaseToken(app, { grant_type: 'authorization_code', code: 'fictional_code', code_verifier: 'fictional_verifier' });
    expect(result).toMatchObject({ accessToken: 'fictional_access', refreshToken: 'fictional_refresh' });
    expect(result).not.toHaveProperty('secret_extra');
    expect(http.mock.calls[0][0]).toBe('https://api.supabase.com/v1/oauth/token');
    expect(new Headers(http.mock.calls[0][1]?.headers).get('Authorization')).toBe(`Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`);
    expect(http.mock.calls[0][1]?.redirect).toBe('error');
  });
  it('reads schema metadata only through the read-only API with parameters', async () => {
    http.mockResolvedValue(Response.json([{ table_name: 'orders', column_name: 'id', ignored: 'not returned' }]));
    expect(await fetchSupabaseSchema('synthetic_token', 'abcdefghijklmnopqrst')).toEqual([{ name: 'orders', columns: ['id'] }]);
    expect(http.mock.calls[0][0]).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query/read-only');
    const body = JSON.parse(String(http.mock.calls[0][1]?.body));
    expect(body.parameters).toEqual(['public']); expect(body.query).toContain('information_schema.columns'); expect(body.query).toContain('LIMIT 1001');
    await expect(fetchSupabaseSchema('synthetic_token', '../other')).rejects.toMatchObject({ status: 400 });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('projects allowlisted metadata instead of returning provider database details', async () => {
    http.mockResolvedValue(Response.json([{ ref: 'abcdefghijklmnopqrst', name: 'Example', organization_slug: 'example-org', region: 'us-east-1', database: { host: 'private.host' }, api_key: 'must_not_escape' }]));
    const result = await fetchSupabaseProjects('synthetic_token');
    expect(result[0]).toEqual({ ref: 'abcdefghijklmnopqrst', name: 'Example', organization: 'example-org', region: 'us-east-1' });
  });
  it('uses the documented revocation body without putting secrets in the URL', async () => {
    http.mockResolvedValue(new Response(null, { status: 204 }));
    await revokeSupabaseToken(app, 'fictional_refresh');
    expect(http.mock.calls[0][0]).toBe('https://api.supabase.com/v1/oauth/revoke');
    expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toEqual({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: 'fictional_refresh' });
  });
  it('hides provider error bodies and bounds success responses', async () => {
    http.mockResolvedValueOnce(Response.json({ error: 'secret customer data' }, { status: 401 }));
    await expect(fetchSupabaseProjects('synthetic_token')).rejects.toMatchObject({ code: 'provider_reauthorize' });
    http.mockResolvedValueOnce(Response.json({ error: 'secret customer data' }, { status: 500 }));
    await expect(fetchSupabaseProjects('synthetic_token')).rejects.not.toHaveProperty('message', expect.stringContaining('secret customer'));
    http.mockResolvedValueOnce(new Response('x'.repeat(270000)));
    await expect(fetchSupabaseProjects('synthetic_token')).rejects.toMatchObject({ code: 'provider_response_limit' });
  });
});

it('sends server-built evidence SQL and bound values only to the read-only endpoint', async () => {
  const { querySupabaseReadOnly } = await import('../aws/supabase-api.ts');
  http.mockResolvedValueOnce(Response.json([{ id: 'order1' }]));
  const query = 'SELECT "id" FROM public."orders" WHERE "payment_ref"::text = $1 LIMIT 2';
  await querySupabaseReadOnly('synthetic_customer_access', 'abcdefghijklmnopqrst', query, ['pi_verified']);
  const [url, init] = http.mock.calls[0];
  expect(url).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query/read-only');
  expect(init?.method).toBe('POST'); expect(JSON.parse(String(init?.body))).toEqual({ query, parameters: ['pi_verified'] });
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic_customer_access');
});
