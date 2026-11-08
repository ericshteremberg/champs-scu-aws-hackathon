import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ secret: vi.fn() }));
vi.mock('@aws-sdk/client-secrets-manager', () => ({ SecretsManagerClient: class { send = mocks.secret; }, GetSecretValueCommand: class { constructor(public input: unknown) {} } }));
import { loadStripeOAuthApp, exchangeStripeOAuthToken, stripeAuthorizationUrl, verifyStripeOAuthRead, type StripeOAuthApp } from '../aws/stripe-oauth-api.ts';
const app: StripeOAuthApp = { clientId: 'ca_fictional', developerApiKey: 'sk_live_FICTIONAL', authorizeUrl: 'https://marketplace.stripe.com/oauth/v2/private_fixture/authorize?client_id=ca_fictional&redirect_uri=https%3A%2F%2Fdev.example.test%2Fapi%2Fproviders%2Fstripe%2Fcallback', mode: 'live', redirectUri: 'https://dev.example.test/api/providers/stripe/callback' };
const response = () => ({ access_token: 'synthetic_customer_access', refresh_token: 'synthetic_customer_refresh', stripe_user_id: 'acct_customer', livemode: true, scope: 'stripe_apps', token_type: 'bearer' });
const tokens = { accessToken: 'synthetic_customer_access', refreshToken: 'synthetic_customer_refresh', accountId: 'acct_customer', mode: 'live' as const, expiresAt: Date.now() + 3600000 };
const http = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal('fetch', http); http.mockReset(); mocks.secret.mockReset(); process.env.STRIPE_OAUTH_SECRET_ARN = 'synthetic_stripe_arn'; process.env.CAUSALITY_FRONTEND_ORIGIN = 'https://dev.example.test'; mocks.secret.mockResolvedValue({ SecretString: JSON.stringify(app) }); });
afterEach(() => vi.unstubAllGlobals());
describe('Stripe Apps API boundary', () => {
  it('loads the app by ARN, preserves the private test link and adds browser state', async () => {
    expect(await loadStripeOAuthApp()).toEqual(app); expect(mocks.secret.mock.calls[0][0].input).toEqual({ SecretId: 'synthetic_stripe_arn' });
    const url = new URL(stripeAuthorizationUrl(app, 'fresh-state')); expect(url.pathname).toBe('/oauth/v2/private_fixture/authorize'); expect(url.searchParams.get('state')).toBe('fresh-state');
    expect(url.toString()).not.toContain(app.developerApiKey);
  });
  it('rejects mismatched client, callback, host and developer key environment', async () => {
    for (const changes of [{ authorizeUrl: app.authorizeUrl.replace('ca_fictional', 'ca_other') }, { authorizeUrl: app.authorizeUrl.replace('marketplace.stripe.com', 'untrusted.test') }, { redirectUri: 'https://untrusted.test/callback' }, { developerApiKey: 'sk_test_FICTIONAL' }]) {
      mocks.secret.mockResolvedValueOnce({ SecretString: JSON.stringify({ ...app, ...changes }) }); await expect(loadStripeOAuthApp()).rejects.toMatchObject({ code: 'provider_not_configured' });
    }
  });
  it('uses the Apps token endpoint and developer Basic key only for exchange/refresh', async () => {
    http.mockImplementation(async () => Response.json(response()));
    const result = await exchangeStripeOAuthToken(app, { grant_type: 'authorization_code', code: 'fictional_code' });
    expect(result).toMatchObject({ accountId: 'acct_customer', mode: 'live' }); expect(result.expiresAt).toBeGreaterThan(Date.now() + 3500000);
    await exchangeStripeOAuthToken(app, { grant_type: 'refresh_token', refresh_token: 'fictional_refresh' });
    for (const [url, init] of http.mock.calls) { expect(url).toBe('https://api.stripe.com/v1/oauth/token'); expect(new Headers(init?.headers).get('Authorization')).toBe(`Basic ${Buffer.from(`${app.developerApiKey}:`).toString('base64')}`); expect(init?.redirect).toBe('error'); }
    expect(String(http.mock.calls[1][1]?.body)).toContain('grant_type=refresh_token');
  });
  it('rejects non-Apps scopes and a mismatched live/test token', async () => {
    for (const changes of [{ scope: 'read_write' }, { livemode: false }, { stripe_user_id: 'not-account' }]) {
      http.mockResolvedValueOnce(Response.json({ ...response(), ...changes })); await expect(exchangeStripeOAuthToken(app, { grant_type: 'authorization_code', code: 'fictional' })).rejects.toMatchObject({ code: 'provider_invalid_response' });
    }
  });
  it('uses only the customer token for bounded dispute/charge GETs and returns no record contents', async () => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'dp_fictional', charge: 'ch_fictional', livemode: true, evidence: { customer_email_address: 'private@example.test' } }] }));
    http.mockResolvedValueOnce(Response.json({ id: 'ch_fictional', livemode: true, billing_details: { name: 'Private customer' } }));
    expect(await verifyStripeOAuthRead(tokens)).toEqual({ disputeReadVerified: true, chargeReadVerified: true });
    expect(http.mock.calls.map(([url]) => url)).toEqual(['https://api.stripe.com/v1/disputes?limit=1', 'https://api.stripe.com/v1/charges/ch_fictional']);
    for (const [, init] of http.mock.calls) { expect(init?.method).toBe('GET'); expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${tokens.accessToken}`); expect(new Headers(init?.headers).has('Stripe-Account')).toBe(false); }
  });
  it('does not claim charge access was tested without a dispute or linked charge', async () => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [] })); expect(await verifyStripeOAuthRead(tokens)).toEqual({ disputeReadVerified: true, chargeReadVerified: false }); expect(http).toHaveBeenCalledTimes(1);
  });
  it.each(['ch_fictional', 'py_fictional'])('verifies du disputes with a %s payment', async (chargeId) => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'du_fictional', charge: chargeId, livemode: true }] }));
    http.mockResolvedValueOnce(Response.json({ id: chargeId, livemode: true }));
    expect(await verifyStripeOAuthRead(tokens)).toEqual({ disputeReadVerified: true, chargeReadVerified: true });
    expect(http.mock.calls[1][0]).toBe(`https://api.stripe.com/v1/charges/${chargeId}`);
  });
  it.each(['https://untrusted.test/payment', 'ch_bad/path', 'pi_wrongtype'])('rejects an invalid linked payment %s before reading it', async (chargeId) => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'du_fictional', charge: chargeId, livemode: true }] }));
    await expect(verifyStripeOAuthRead(tokens)).rejects.toMatchObject({ code: 'provider_invalid_response' });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('rejects a du dispute from the wrong environment before reading its payment', async () => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'du_fictional', charge: 'py_fictional', livemode: false }] }));
    await expect(verifyStripeOAuthRead(tokens)).rejects.toMatchObject({ code: 'provider_invalid_response' });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched payment identities and mode', async () => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'dp_fictional', charge: 'ch_fictional', livemode: true }] })); http.mockResolvedValueOnce(Response.json({ id: 'ch_other', livemode: true })); await expect(verifyStripeOAuthRead(tokens)).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });
  it('sanitizes provider errors and bounds response bodies', async () => {
    http.mockResolvedValueOnce(Response.json({ error: 'private_key_detail' }, { status: 401 })); await expect(verifyStripeOAuthRead(tokens)).rejects.toMatchObject({ code: 'provider_reauthorize' });
    http.mockResolvedValueOnce(new Response('x'.repeat(270000))); await expect(verifyStripeOAuthRead(tokens)).rejects.toMatchObject({ code: 'provider_response_limit' });
  });
});

describe('selected dispute evidence reads', () => {
  const dispute = { id: 'du_fictional', object: 'dispute', charge: 'ch_fictional', payment_intent: 'pi_fictional', livemode: true, amount: 5000, currency: 'usd', reason: 'product_not_received', status: 'needs_response', created: 1793491200, evidence_details: { due_by: 1796083200 }, evidence: { private_unrequested: 'excluded' } };
  const charge = { id: 'ch_fictional', object: 'charge', payment_intent: 'pi_fictional', livemode: true, amount: 5000, currency: 'usd', billing_details: { email: 'customer@example.test', name: 'Customer' }, metadata: { private_unrequested: 'excluded' } };
  it('accepts current du_ dispute IDs for the connection check', async () => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [dispute] })).mockResolvedValueOnce(Response.json(charge));
    expect(await verifyStripeOAuthRead(tokens)).toEqual({ disputeReadVerified: true, chargeReadVerified: true });
  });
  it('lists a maximum of ten summaries without returning full evidence or customer records', async () => {
    http.mockResolvedValueOnce(Response.json({ object: 'list', data: [dispute], has_more: true }));
    const { listStripeOAuthDisputes } = await import('../aws/stripe-oauth-api.ts');
    const result = await listStripeOAuthDisputes(tokens); expect(result).toMatchObject({ disputes: [{ id: dispute.id, amount: 5000 }], moreAvailable: true }); expect(JSON.stringify(result)).not.toContain('private_unrequested');
    expect(http.mock.calls[0][0]).toBe('https://api.stripe.com/v1/disputes?limit=10');
  });
  it('resolves the charge with the customer token and strips unrelated fields', async () => {
    http.mockResolvedValueOnce(Response.json(dispute)).mockResolvedValueOnce(Response.json(charge));
    const { readStripeOAuthDispute } = await import('../aws/stripe-oauth-api.ts');
    const result = await readStripeOAuthDispute(tokens, dispute.id); expect(result).toMatchObject({ chargeId: charge.id, paymentIntentId: charge.payment_intent, accountId: tokens.accountId, email: 'customer@example.test' });
    expect(JSON.stringify(result)).not.toContain('private_unrequested'); expect(JSON.stringify(result)).not.toContain(tokens.accessToken);
    for (const [, init] of http.mock.calls) { expect(init?.method).toBe('GET'); expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${tokens.accessToken}`); expect(new Headers(init?.headers).has('Stripe-Account')).toBe(false); }
  });
  it('rejects mismatched payments, environments, currency and charge amount', async () => {
    const { readStripeOAuthDispute } = await import('../aws/stripe-oauth-api.ts');
    for (const change of [{ id: 'ch_another' }, { payment_intent: 'pi_another' }, { livemode: false }, { currency: 'eur' }, { amount: 4999 }]) {
      http.mockResolvedValueOnce(Response.json(dispute)).mockResolvedValueOnce(Response.json({ ...charge, ...change })); await expect(readStripeOAuthDispute(tokens, dispute.id)).rejects.toMatchObject({ code: 'provider_invalid_response' });
    }
    http.mockClear(); await expect(readStripeOAuthDispute(tokens, '../charges/all')).rejects.toMatchObject({ code: 'invalid_request' }); expect(http).not.toHaveBeenCalled();
  });
});

it('lists and imports a du dispute whose linked charge uses the py prefix', async () => {
  const { listStripeOAuthDisputes, readStripeOAuthDispute } = await import('../aws/stripe-oauth-api.ts');
  const dispute = { id: 'du_fictional', object: 'dispute', charge: 'py_fictional', payment_intent: 'pi_fictional', livemode: true, amount: 5000, currency: 'usd', reason: 'product_not_received', status: 'needs_response', created: 1793491200, evidence_details: { due_by: 1796083200 } };
  http.mockResolvedValueOnce(Response.json({ object: 'list', data: [dispute], has_more: false }));
  expect((await listStripeOAuthDisputes(tokens)).disputes[0].id).toBe(dispute.id);
  http.mockResolvedValueOnce(Response.json(dispute)).mockResolvedValueOnce(Response.json({ id: 'py_fictional', object: 'charge', payment_intent: 'pi_fictional', livemode: true, amount: 5000, currency: 'usd' }));
  expect(await readStripeOAuthDispute(tokens, dispute.id)).toMatchObject({ chargeId: 'py_fictional', paymentIntentId: 'pi_fictional' });
  expect(http.mock.calls[2][0]).toBe('https://api.stripe.com/v1/charges/py_fictional');
});
