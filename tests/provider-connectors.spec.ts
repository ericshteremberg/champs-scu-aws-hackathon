import { expect, test, type Page } from '@playwright/test';
import type { ProviderStatus, SupabaseConnection } from '../lib/providers/types';

async function setup(page: Page, connection: SupabaseConnection | null = null, stripe: ProviderStatus['stripe'] = { configured: false, reason: 'Pending' }, gmail: ProviderStatus['gmail'] = { configured: false, connection: null }) {
  const identity = `provider-ui-${crypto.randomUUID()}`;
  const headers = { 'oai-authenticated-user-id': identity, 'oai-authenticated-user-email': `${identity}@example.test`, 'oai-authenticated-user-full-name': 'Provider Reviewer' };
  await page.context().setExtraHTTPHeaders(headers);
  const base = process.env.CAUSALITY_UI_TEST_BASEURL || 'http://127.0.0.1:8788';
  expect((await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: 'createWorkspace', name: 'Provider UI test' } })).status()).toBe(200);
  const status: ProviderStatus = { supabase: { configured: true, connection }, stripe, gmail, imap: { configured: true, connection: null } };
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/providers/resend', route => route.fulfill({ json: { configured: false, verifiedAt: null, domains: [] } }));
  await page.route('**/api/providers/evidence', route => route.fulfill({ json: { mapping: null, eligibleCaseIds: [] } }));
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
  return { identity, headers, status, base, panel: page.getByRole('region', { name: 'Business account connections' }), requests };
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
  await expect(panel.getByRole('status')).toContainText('Map these columns to a verified Stripe payment');
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
  await expect(panel.getByRole('status').filter({ hasText: 'Authorization was canceled' })).toContainText('Authorization was canceled');
  await expect(page).not.toHaveURL(/provider_result/);
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
});

test('Stripe Connect opens the exact private test path without asking for keys', async ({ page }) => {
  const { panel } = await setup(page, null, { configured: true, connection: null });
  await expect(panel.getByRole('button', { name: 'Connect Stripe', exact: true })).toBeEnabled();
  await expect(panel).toContainText('Not reviewed by Stripe');
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


test('Gmail authorization opens Google without asking customers for credentials', async ({ page }) => {
  const { panel } = await setup(page, null, undefined, { configured: true, connection: null });
  await page.route('**/api/providers/gmail/start', route => route.fulfill({ json: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=https://www.googleapis.com/auth/gmail.readonly&state=fictional' } }));
  await page.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fictional Google consent</h1>' }));
  await panel.getByRole('button', { name: 'Connect Gmail', exact: true }).click();
  await expect(page).toHaveURL(/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
});

test('Gmail requires preview before import, renders email as text and disconnects on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { headers, base, status } = await setup(page, null, undefined, { configured: true, connection: { status: 'authorized', updatedAt: new Date().toISOString(), email: 'merchant@example.test' } });
  const response = await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: 'addCase', title: 'Gmail ticket case', customerName: 'Customer', email: 'customer@example.test', amount: 5000, currency: 'usd', reason: 'Ticket not received', orderRef: 'ORDER-1', dueAt: '2026-12-01' } });
  expect(response.status()).toBe(200); const caseId = (await response.json()).cases[0].id;
  const message = { id: 'ab12', threadId: 'cd34', subject: 'Ticket support', from: 'customer@example.test', to: 'merchant@example.test', occurredAt: '2026-11-01T00:00:00Z' };
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/providers/gmail', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.action === 'search') return route.fulfill({ json: { messages: [message], moreAvailable: true } });
    if (body.action === 'preview') return route.fulfill({ json: { preview: { ...message, text: '<script>window.gmailInjected=true</script> Original customer statement', truncated: false } } });
    if (body.action === 'import') return route.fulfill({ json: { imported: true, caseId } });
    status.gmail!.connection = { status: 'disconnected', updatedAt: new Date().toISOString() };
    return route.fulfill({ json: { connection: status.gmail!.connection } });
  });
  await page.goto('/workspace?view=integrations&provider_result=gmail_authorized');
  const card = page.getByRole('article', { name: 'Gmail account authorization' });
  await expect(card.getByRole('button', { name: 'Find customer emails' })).toBeDisabled();
  await card.getByRole('combobox', { name: 'Case for Gmail evidence' }).selectOption(caseId);
  await card.getByRole('button', { name: 'Find customer emails' }).click();
  await expect(card.getByRole('button', { name: 'Import reviewed email' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Preview email Ticket support' }).click();
  await expect(card.locator('pre')).toContainText('<script>window.gmailInjected=true</script>');
  expect(await page.evaluate(() => 'gmailInjected' in window)).toBe(false);
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await card.getByRole('button', { name: 'Import reviewed email' }).click();
  await expect(page).toHaveURL(/view=cases/); expect(requests.at(-1)).toEqual({ action: 'import', caseId, messageId: 'ab12', confirmed: true });
  await page.goto('/workspace?view=integrations');
  await card.getByRole('button', { name: 'Disconnect Gmail', exact: true }).click();
  await card.getByRole('button', { name: 'Confirm disconnect Gmail' }).click();
  await expect(card.getByRole('button', { name: 'Connect Gmail', exact: true })).toBeEnabled();
});

test('Gmail stays unavailable without developer registration', async ({ page }) => {
  const { panel } = await setup(page);
  await expect(panel.getByRole('button', { name: 'Gmail setup unavailable' })).toBeDisabled();
  await expect(panel).toContainText('Google app setup is required');
});

test('IMAP setup requires consent, clears passwords on failure and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const card = page.getByRole('article', { name: 'Other email IMAP connection' });
  await card.getByRole('button', { name: 'Connect other email' }).click();
  await card.getByLabel('Mailbox email', { exact: true }).fill('merchant@example.test');
  await card.getByText('Advanced settings', { exact: true }).click();
  await card.getByLabel('Incoming IMAP server').fill('imap.provider.com');
  await card.getByLabel('Mailbox or app password').fill('synthetic_private_password');
  const submit = card.getByRole('button', { name: 'Test and connect mailbox' });
  await expect(submit).toBeDisabled();
  await card.getByRole('checkbox', { name: /I authorize Causality/ }).check();
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/providers/imap', async route => { sent = route.request().postDataJSON(); return route.fulfill({ status: 502, json: { error: 'Could not read this mailbox. Check the server.' } }); });
  await submit.click();
  await expect(card.getByRole('alert')).toContainText('Check the server');
  await expect(card.getByLabel('Mailbox or app password')).toHaveValue('');
  expect(sent).toEqual({ action: 'connect', settings: { email: 'merchant@example.test', host: 'imap.provider.com', password: 'synthetic_private_password', folders: ['INBOX'] }, detectSent: true, confirmed: true });
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('synthetic_private_password');
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('IMAP connection searches a selected case and imports only after preview', async ({ page }) => {
  const { status, base, headers } = await setup(page);
  const response = await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: 'addCase', title: 'Missing IMAP ticket', customerName: 'Customer', email: 'customer@example.test', amount: 5000, currency: 'usd', reason: 'Ticket not received', orderRef: 'ORDER-IMAP', dueAt: '2026-12-01' } });
  const caseId = (await response.json()).cases[0].id;
  const requests: Record<string, unknown>[] = [];
  const message = { id: 'SU5CT1g.7.123', folder: 'INBOX', subject: 'Ticket support', from: 'customer@example.test', to: 'merchant@example.test', occurredAt: '2026-11-01T00:00:00Z' };
  await page.route('**/api/providers/imap', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.action === 'connect') { status.imap!.connection = { status: 'authorized', updatedAt: new Date().toISOString(), email: body.settings.email, host: body.settings.host, folders: body.settings.folders }; return route.fulfill({ json: { connection: status.imap!.connection } }); }
    if (body.action === 'search') return route.fulfill({ json: { messages: [message], scanLimited: true, moreAvailable: false } });
    if (body.action === 'preview') return route.fulfill({ json: { preview: { ...message, text: '<script>window.imapInjected=true</script> Original statement', truncated: false } } });
    if (body.action === 'import') return route.fulfill({ json: { imported: true, caseId } });
    status.imap!.connection = { status: 'disconnected', updatedAt: new Date().toISOString() };
    return route.fulfill({ json: { connection: status.imap!.connection } });
  });
  await page.goto('/workspace?view=integrations');
  const card = page.getByRole('article', { name: 'Other email IMAP connection' });
  await card.getByRole('button', { name: 'Connect other email' }).click();
  await card.getByLabel('Mailbox email', { exact: true }).fill('merchant@example.test');
  await card.getByText('Advanced settings', { exact: true }).click();
  await card.getByLabel('Incoming IMAP server').fill('imap.provider.com');
  await card.getByLabel('Mailbox or app password').fill('synthetic_private_password');
  await card.getByLabel('Sent folder name (optional)').fill('Sent');
  await card.getByRole('checkbox', { name: /I authorize Causality/ }).check();
  await card.getByRole('button', { name: 'Test and connect mailbox' }).click();
  await expect(card.getByRole('button', { name: 'Find customer emails via IMAP' })).toBeDisabled();
  await card.getByLabel('Case for IMAP evidence').selectOption(caseId);
  await card.getByRole('button', { name: 'Find customer emails via IMAP' }).click();
  await expect(card.getByRole('status')).toContainText('newest 500 messages');
  await expect(card.getByRole('button', { name: 'Import reviewed IMAP email' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Preview email Ticket support' }).click();
  await expect(card.locator('pre')).toContainText('<script>window.imapInjected=true</script>');
  expect(await page.evaluate(() => 'imapInjected' in window)).toBe(false);
  await card.getByRole('button', { name: 'Import reviewed IMAP email' }).click();
  await expect(page).toHaveURL(/view=cases/);
  expect(requests.at(-1)).toEqual({ action: 'import', caseId, messageId: message.id, confirmed: true });
  await page.goto('/workspace?view=integrations');
  await card.getByRole('button', { name: 'Disconnect IMAP', exact: true }).click();
  await card.getByRole('button', { name: 'Confirm disconnect IMAP' }).click();
  await expect(card.getByRole('button', { name: 'Connect other email' })).toBeEnabled();
});

test('IMAP detects the provider before requesting a password and submits automatic folder discovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/providers/imap', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.action === 'discover') return route.fulfill({ json: { discovery: { kind: 'imap', provider: 'Network Solutions', host: 'netsol-imap-oxcs.hostingplatform.com', source: 'provider_dns' } } });
    return route.fulfill({ json: { connection: { status: 'authorized', email: body.settings.email, host: body.settings.host, folders: ['INBOX', 'Sent Items'] } } });
  });
  const card = page.getByRole('article', { name: 'Other email IMAP connection' });
  await card.getByRole('button', { name: 'Connect other email' }).click();
  await expect(card.getByLabel('Mailbox or app password')).toHaveCount(0);
  await expect(card.getByLabel('Incoming IMAP server')).toBeHidden();
  await card.getByLabel('Mailbox email', { exact: true }).fill('support@business.com');
  await card.getByRole('button', { name: 'Find email settings' }).click();
  await expect(card.getByRole('status')).toContainText('Network Solutions detected');
  expect(requests).toEqual([{ action: 'discover', email: 'support@business.com' }]);
  await expect(card.getByLabel('Incoming IMAP server')).toBeHidden();
  await card.getByLabel('Mailbox or app password').fill('synthetic-password');
  await card.getByRole('checkbox', { name: /I authorize Causality/ }).check();
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await card.getByRole('button', { name: 'Test and connect mailbox' }).click();
  await expect(card).toContainText('Folders: INBOX, Sent Items');
  expect(requests.at(-1)).toEqual({ action: 'connect', settings: { email: 'support@business.com', host: 'netsol-imap-oxcs.hostingplatform.com', password: 'synthetic-password', folders: ['INBOX'] }, detectSent: true, confirmed: true });
});

test('IMAP falls back to manual settings and clears passwords when the account changes', async ({ page }) => {
  await setup(page);
  await page.route('**/api/providers/imap', route => route.fulfill({ json: { discovery: { kind: 'manual', reason: 'unavailable' } } }));
  const card = page.getByRole('article', { name: 'Other email IMAP connection' });
  await card.getByRole('button', { name: 'Connect other email' }).click();
  await card.getByLabel('Mailbox email', { exact: true }).fill('support@business.com');
  await card.getByRole('button', { name: 'Find email settings' }).click();
  await expect(card.getByLabel('Incoming IMAP server')).toBeVisible();
  await card.getByLabel('Incoming IMAP server').fill('imap.business.com');
  await card.getByLabel('Mailbox or app password').fill('synthetic-password');
  await card.getByRole('checkbox', { name: /I authorize Causality/ }).check();
  await card.getByLabel('Mailbox email', { exact: true }).fill('different@business.com');
  await expect(card.getByLabel('Mailbox or app password')).toHaveCount(0);
  await card.getByLabel('Incoming IMAP server').fill('imap.business.com');
  await expect(card.getByLabel('Mailbox or app password')).toHaveValue('');
  await expect(card.getByRole('checkbox', { name: /I authorize Causality/ })).not.toBeChecked();
});

test('Google discovery directs customers to OAuth without asking for a mailbox password', async ({ page }) => {
  await setup(page);
  await page.route('**/api/providers/imap', route => route.fulfill({ json: { discovery: { kind: 'oauth', provider: 'Google' } } }));
  const card = page.getByRole('article', { name: 'Other email IMAP connection' });
  await card.getByRole('button', { name: 'Connect other email' }).click();
  await card.getByLabel('Mailbox email', { exact: true }).fill('support@gmail.com');
  await card.getByRole('button', { name: 'Find email settings' }).click();
  await expect(card.getByRole('link', { name: 'Use Connect Gmail' })).toHaveAttribute('href', '#gmail-connection');
  await expect(card.getByLabel('Mailbox or app password')).toHaveCount(0);
});
