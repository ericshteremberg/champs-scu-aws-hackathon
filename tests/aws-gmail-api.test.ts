import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const secret = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-secrets-manager', () => ({ GetSecretValueCommand: class { constructor(public input: unknown) {} }, SecretsManagerClient: class { send = secret.send; } }));
import { exchangeGmailToken, gmailProfile, GMAIL_SCOPE, loadGmailApp, previewGmail, revokeGmailToken, searchGmail, type GmailApp } from '../aws/gmail-api.ts';
const app: GmailApp = { clientId: 'fake.apps.googleusercontent.com', clientSecret: 'synthetic_secret', redirectUri: 'https://dev.example.test/api/providers/gmail/callback', scopes: [GMAIL_SCOPE] };
const fetchMock = vi.fn();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const plain = { mimeType: 'text/plain', body: { data: Buffer.from('Original email\n<script>alert(1)</script>').toString('base64url') } };
const message = { id: 'ab12', threadId: 'cd34', internalDate: '1793491200000', payload: { ...plain, headers: [{ name: 'Subject', value: 'Ticket support' }] } };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock); process.env.CAUSALITY_FRONTEND_ORIGIN = 'https://dev.example.test'; process.env.GMAIL_OAUTH_SECRET_ARN = 'synthetic_arn'; secret.send.mockResolvedValue({ SecretString: JSON.stringify(app) }); });
afterEach(() => vi.unstubAllGlobals());
describe('bounded read-only Gmail transport', () => {
  it('loads only the configured secret and rejects callback/scope drift', async () => {
    expect(await loadGmailApp()).toEqual(app); expect(secret.send.mock.calls[0][0].input).toEqual({ SecretId: 'synthetic_arn' });
    secret.send.mockResolvedValueOnce({ SecretString: JSON.stringify({ ...app, scopes: ['https://mail.google.com/'] }) }); await expect(loadGmailApp()).rejects.toMatchObject({ code: 'provider_not_configured' });
    secret.send.mockResolvedValueOnce({ SecretString: JSON.stringify({ ...app, redirectUri: 'https://evil.example/callback' }) }); await expect(loadGmailApp()).rejects.toMatchObject({ code: 'provider_not_configured' });
    delete process.env.GMAIL_OAUTH_SECRET_ARN; await expect(loadGmailApp()).rejects.toMatchObject({ code: 'provider_not_configured' });
  });
  it('exchanges offline tokens, enforces readonly and preserves refresh tokens when Google omits them', async () => {
    const response = { access_token: 'new_access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: GMAIL_SCOPE };
    fetchMock.mockResolvedValueOnce(json(response)); expect(await exchangeGmailToken(app, { grant_type: 'authorization_code', code: 'fake_code', code_verifier: 'fake_verifier' })).toMatchObject({ refreshToken: 'refresh' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token'); expect(fetchMock.mock.calls[0][1].body.get('code_verifier')).toBe('fake_verifier'); expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    fetchMock.mockResolvedValueOnce(json({ ...response, refresh_token: undefined, scope: undefined })); expect(await exchangeGmailToken(app, { grant_type: 'refresh_token', refresh_token: 'original_refresh' })).toMatchObject({ refreshToken: 'original_refresh' });
    fetchMock.mockResolvedValueOnce(json({ ...response, scope: 'https://mail.google.com/' })); await expect(exchangeGmailToken(app, { grant_type: 'authorization_code', code: 'code', code_verifier: 'verifier' })).rejects.toMatchObject({ code: 'provider_invalid_response' });
    fetchMock.mockResolvedValueOnce(json({ ...response, refresh_token: undefined })); await expect(exchangeGmailToken(app, { grant_type: 'authorization_code', code: 'code', code_verifier: 'verifier' })).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });
  it('builds a fixed case-email query, fetches metadata and rejects search injection', async () => {
    fetchMock.mockResolvedValueOnce(json({ messages: [{ id: 'ab12' }], nextPageToken: 'more' })).mockResolvedValueOnce(json(message));
    expect(await searchGmail('access', 'customer@example.test')).toMatchObject({ messages: [{ id: 'ab12', subject: 'Ticket support' }], moreAvailable: true });
    const url = new URL(fetchMock.mock.calls[0][0]); expect(url.searchParams.get('q')).toBe('{from:customer@example.test to:customer@example.test}'); expect(url.searchParams.get('maxResults')).toBe('10');
    expect(fetchMock.mock.calls[1][0]).toContain('format=metadata'); for (const [, init] of fetchMock.mock.calls) { expect(init.method).toBe('GET'); expect(init.headers.Authorization).toBe('Bearer access'); }
    await expect(searchGmail('access', 'customer@example.test} OR {in:anywhere')).rejects.toMatchObject({ code: 'invalid_case_email' });
  });
  it('keeps email text inert and excludes HTML, file attachments and attached forwarded messages', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...message, payload: { mimeType: 'multipart/mixed', parts: [plain, { mimeType: 'text/html', body: { data: Buffer.from('<b>Hidden HTML</b>').toString('base64url') } }, { ...plain, filename: 'private.txt' }, { mimeType: 'message/rfc822', parts: [plain] }] } }));
    const result = await previewGmail('access', 'ab12'); expect(result.text).toBe('Original email\n<script>alert(1)</script>'); expect(result.truncated).toBe(false);
    fetchMock.mockResolvedValueOnce(json({ ...message, payload: { mimeType: 'text/html', body: { data: 'ZmFrZQ' } } })); await expect(previewGmail('access', 'ab12')).rejects.toMatchObject({ code: 'gmail_plain_text_required' });
  });
  it('marks long excerpts, rejects oversized responses and mismatched IDs', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...message, payload: { ...plain, body: { data: Buffer.from('x'.repeat(21000)).toString('base64url') } } })); const result = await previewGmail('access', 'ab12'); expect(result.text).toHaveLength(20000); expect(result.truncated).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(300000))); await expect(previewGmail('access', 'ab12')).rejects.toMatchObject({ code: 'provider_response_limit' });
    fetchMock.mockResolvedValueOnce(json({ ...message, id: 'ffff' })); await expect(previewGmail('access', 'ab12')).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });
  it('sanitizes errors and uses a dedicated revoke endpoint without mailbox mutations', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'private error' }, 401)); await expect(gmailProfile('access')).rejects.toMatchObject({ code: 'provider_reauthorize' });
    fetchMock.mockRejectedValueOnce(new Error('token=private')); await expect(gmailProfile('access')).rejects.toThrow('Gmail could not complete this request.');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 })); await revokeGmailToken('refresh'); expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://oauth2.googleapis.com/revoke'); expect(fetchMock.mock.calls.at(-1)![1].body.get('token')).toBe('refresh');
  });
});
