import { expect, test, type Page } from '@playwright/test';
import type { ProviderStatus, SupabaseConnection } from '../lib/providers/types';

async function setup(page: Page, connection: SupabaseConnection | null = null, stripe: ProviderStatus['stripe'] = { configured: false, reason: 'Pending' }) {
  const identity = `provider-ui-${crypto.randomUUID()}`;
  const headers = { 'oai-authenticated-user-id': identity, 'oai-authenticated-user-email': `${identity}@example.test`, 'oai-authenticated-user-full-name': 'Provider Reviewer' };
  await page.context().setExtraHTTPHeaders(headers);
  const base = process.env.CAUSALITY_UI_TEST_BASEURL || 'http://127.0.0.1:8788';
  expect((await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: 'createWorkspace', name: 'Provider UI test' } })).status()).toBe(200);
  const status: ProviderStatus = { supabase: { configured: true, connection }, stripe };
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/providers', route => route.fulfill({ json: status }));
  await page.route('**/api/providers/stripe', async route => {
    const body = route.request().postDataJSON(); requests.push({ provider: 'stripe', ...body });
    if (body.action === 'verify') status.stripe.connection = { ...status.stripe.connection!, lastVerifiedAt: new Date().toISOString(), chargeReadVerified: true };
    if (body.action === 'disconnect') status.stripe.connection = { status: 'disconnected', updatedAt: new Date().toISOString(), uninstallRequired: true };
    return route.fulfill({ json: { connection: status.stripe.connection, chargeReadVerified: body.action === 'verify' } });
  });
  await page.route('**/api/providers/supabase', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.action === 'projects') return route.fulfill({ json: { projects: [{ ref: 'abcdefghijklmnopqrst', name: 'Tickets', organization: 'Example', region: 'us-east-1' }] } });
    if (body.action === 'schema') return route.fulfill({ json: { schema: [{ name: 'orders', columns: ['id', 'payment_ref', 'private_token'] }], schemaName: 'public' } });
    if (body.action === 'select_project') status.supabase.connection = { status: 'authorized', updatedAt: new Date().toISOString(), project: { ref: body.projectRef, name: 'Tickets', organization: 'Example', region: 'us-east-1' } };
    if (body.action === 'approve_tables') status.supabase.connection = { ...status.supabase.connection!, approvedTables: body.tables };
    if (body.action === 'disconnect') status.supabase.connection = { status: 'disconnected', updatedAt: new Date().toISOString(), revocationPending: false };
    return route.fulfill({ json: { connection: status.supabase.connection } });
  });
  await page.goto('/workspace?view=integrations');
  return { panel: page.getByRole('region', { name: 'Business account connections' }), requests };
}

test('customer starts authorization with a button and no key-entry fields', async ({ page }) => {
  const { panel } = await setup(page);
  await expect(panel.getByRole('button', { name: 'Connect Supabase', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Stripe setup unavailable', exact: true })).toBeDisabled();
  await expect(panel.locator('input[type="password"]')).toHaveCount(0);
  await page.route('**/api/providers/supabase/start', route => route.fulfill({ json: { authorizationUrl: 'https://api.supabase.com/v1/oauth/authorize?state=fictional&code_challenge=fictional' } }));
  await page.route('https://api.supabase.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fictional provider consent</h1>' }));
  await panel.getByRole('button', { name: 'Connect Supabase', exact: true }).click();
  await expect(page).toHaveURL(/api\.supabase\.com\/v1\/oauth\/authorize/);
});

test('customer selects project, approves only checked columns and disconnects', async ({ page }) => {
  const { panel, requests } = await setup(page, { status: 'authorized', updatedAt: new Date().toISOString() });
  await panel.getByRole('button', { name: 'Choose project', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Supabase project', exact: true }).selectOption('abcdefghijklmnopqrst');
  await panel.getByRole('button', { name: 'Use selected project' }).click();
  await panel.getByRole('button', { name: 'Review tables and columns' }).click();
  await panel.locator('summary').filter({ hasText: 'orders' }).click();
  await panel.getByRole('checkbox', { name: 'id', exact: true }).check();
  await panel.getByRole('checkbox', { name: 'payment_ref', exact: true }).check();
  await expect(panel.getByRole('checkbox', { name: 'private_token' })).not.toBeChecked();
  await panel.getByRole('button', { name: 'Save approved scope' }).click();
  await expect(panel.getByRole('status')).toContainText('Live imports will be available after verified payment-to-order mapping');
  expect(requests.at(-1)).toEqual({ action: 'approve_tables', tables: [{ name: 'orders', columns: ['id', 'payment_ref'] }] });
  await panel.getByRole('button', { name: 'Disconnect Supabase', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm disconnect Supabase' }).click();
  await expect(panel.getByRole('button', { name: 'Connect Supabase', exact: true })).toBeEnabled();
  await expect(panel).not.toContainText('Selected project:');
});

test('callback feedback is readable and the connection panel fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel } = await setup(page);
  await page.goto('/workspace?view=integrations&provider_result=denied');
  await expect(panel.getByRole('status')).toContainText('Authorization was canceled');
  await expect(page).not.toHaveURL(/provider_result/);
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
});

test('Stripe Connect opens the exact private test path without asking for keys', async ({ page }) => {
  const { panel } = await setup(page, null, { configured: true, connection: null });
  await expect(panel.getByRole('button', { name: 'Connect Stripe', exact: true })).toBeEnabled();
  await expect(panel).toContainText('has not been reviewed by Stripe');
  await page.route('**/api/providers/stripe/start', route => route.fulfill({ json: { authorizationUrl: 'https://marketplace.stripe.com/oauth/v2/fictional_private_test/authorize?client_id=ca_fictional&state=fictional' } }));
  await page.route('https://marketplace.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fictional Stripe consent</h1>' }));
  await panel.getByRole('button', { name: 'Connect Stripe', exact: true }).click();
  await expect(page).toHaveURL(/marketplace\.stripe\.com\/oauth\/v2\/fictional_private_test\/authorize/);
});

test('Stripe read verification and disconnect use the saved customer connection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, requests } = await setup(page, null, { configured: true, connection: { status: 'authorized', accountId: 'acct_fictional_customer', mode: 'live', updatedAt: new Date().toISOString() } });
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.getByRole('button', { name: 'Verify read access' }).click();
  await expect(panel.getByRole('status')).toContainText('Dispute and linked payment read access verified');
  expect(requests.at(-1)).toEqual({ provider: 'stripe', action: 'verify' });
  await panel.getByRole('button', { name: 'Disconnect Stripe', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm disconnect Stripe' }).click();
  await expect(panel.getByRole('button', { name: 'Connect Stripe', exact: true })).toBeEnabled();
  await expect(panel.getByRole('status')).toContainText('Uninstall Causality in Stripe');
  expect(requests.at(-1)).toEqual({ provider: 'stripe', action: 'disconnect' });
});
