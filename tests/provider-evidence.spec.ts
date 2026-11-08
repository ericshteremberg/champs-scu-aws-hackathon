import { expect, test, type Page } from '@playwright/test';
import type { OrderEvidenceMapping, ProviderStatus } from '../lib/providers/types';
const mapping: OrderEvidenceMapping = { order: { table: 'orders', idColumn: 'id', paymentColumn: 'payment_ref', paymentKind: 'payment_intent', columns: ['id', 'payment_ref'] }, related: [{ table: 'tickets', orderColumn: 'order_id', section: 'tickets', columns: ['order_id', 'status'] }] };
async function setup(page: Page, mapped = true) {
  const identity = `linked-ui-${crypto.randomUUID()}`;
  const headers = { 'oai-authenticated-user-id': identity, 'oai-authenticated-user-email': `${identity}@example.test`, 'oai-authenticated-user-full-name': 'Evidence Reviewer' };
  await page.context().setExtraHTTPHeaders(headers);
  const base = process.env.CAUSALITY_UI_TEST_BASEURL || 'http://127.0.0.1:8788';
  await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: 'createWorkspace', name: 'Evidence UI test' } });
  const result = await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: 'addCase', title: 'Missing ticket', customerName: 'Customer', amount: 5000, reason: 'Ticket not received', dueAt: '2026-12-01' } });
  const caseId = (await result.json()).cases[0].id as string;
  const status: ProviderStatus = { supabase: { configured: true, connection: { status: 'authorized', updatedAt: '2026-11-01', project: { ref: 'abcdefghijklmnopqrst', name: 'Tickets', region: 'us-east-1', organization: 'Example' }, approvedTables: [{ name: 'orders', columns: ['id', 'payment_ref', 'email', 'private_token'] }, { name: 'tickets', columns: ['order_id', 'status'] }] } }, stripe: { configured: true, connection: { status: 'authorized', updatedAt: '2026-11-01', accountId: 'acct_fictional', mode: 'live' } }, gmail: { configured: true, connection: null }, imap: { configured: true, connection: null } };
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/providers/resend', route => route.fulfill({ json: { configured: false, verifiedAt: null, domains: [] } }));
  await page.route('**/api/providers', route => route.fulfill({ json: status }));
  await page.route('**/api/providers/evidence', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { mapping: mapped ? mapping : null, eligibleCaseIds: [caseId] } });
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.action === 'stripe_disputes') return route.fulfill({ json: { disputes: [{ id: 'du_fictional', amount: 5000, currency: 'usd', status: 'needs_response', reason: 'product_not_received', dueAt: '2026-12-01', createdAt: '2026-11-01' }], moreAvailable: false } });
    if (body.action === 'import_stripe_dispute') return route.fulfill({ json: { imported: true, caseId } });
    if (body.action === 'save_mapping') return route.fulfill({ json: { mapping: body.mapping } });
    if (body.action === 'preview_records') return route.fulfill({ json: { preview: { id: '12345678-1234-4234-8234-123456789012', caseId, projectRef: 'abcdefghijklmnopqrst', paymentRef: 'pi_verified', fetchedAt: '2026-11-01T00:00:00Z', records: [{ id: 'fixture1', section: 'order', table: 'orders', fields: { id: 'ORDER-1', payment_ref: 'pi_verified', note: '<img src=x onerror=alert(1)>' } }], limitations: ['Only approved fields. Other records may exist.'] } } });
    return route.fulfill({ json: { imported: true, caseId, count: 1 } });
  });
  await page.goto('/workspace?view=integrations');
  const card = page.getByRole('article', { name: 'Disputes and linked evidence' });
  return { card, requests, caseId, status };
}
test('customer selects one dispute and imports it without supplying payment or account IDs', async ({ page }) => {
  const { card, requests } = await setup(page);
  await card.getByRole('button', { name: 'Load Stripe disputes' }).click();
  await card.getByRole('combobox', { name: 'Stripe dispute', exact: true }).selectOption('du_fictional');
  await expect(card).toContainText('$50.00');
  await card.getByRole('button', { name: 'Import and open case' }).click();
  expect(requests.at(-1)).toEqual({ action: 'import_stripe_dispute', disputeId: 'du_fictional', confirmed: true });
  await expect(page.getByRole('heading', { name: 'Missing ticket', exact: true })).toBeVisible();
});
test('mapping uses only approved fields and supports a direct related table', async ({ page }) => {
  const { card, requests } = await setup(page, false);
  await card.getByRole('combobox', { name: 'Order table', exact: true }).selectOption('orders');
  await card.getByRole('combobox', { name: 'Order ID column', exact: true }).selectOption('id');
  await card.getByRole('combobox', { name: 'Stripe payment column', exact: true }).selectOption('payment_ref');
  await expect(card.getByRole('checkbox', { name: 'private_token', exact: true })).toHaveCount(0);
  await card.getByRole('checkbox', { name: 'id', exact: true }).check(); await card.getByRole('checkbox', { name: 'payment_ref', exact: true }).check();
  await card.getByRole('combobox', { name: 'Customer email column (optional)', exact: true }).selectOption('email');
  await card.getByRole('checkbox', { name: 'email', exact: true }).check();
  await card.getByRole('button', { name: 'Add related table' }).click();
  await card.getByRole('combobox', { name: 'Related table 1', exact: true }).selectOption('tickets'); await card.getByRole('combobox', { name: 'Order link column 1', exact: true }).selectOption('order_id');
  await card.getByRole('checkbox', { name: 'order_id', exact: true }).check(); await card.getByRole('checkbox', { name: 'status', exact: true }).check();
  await card.getByRole('button', { name: 'Save evidence mapping' }).click();
  await expect(card.getByRole('status')).toContainText('Mapping saved'); expect(requests.at(-1)).toEqual({ action: 'save_mapping', mapping: { ...mapping, order: { ...mapping.order, customerEmailColumn: 'email', columns: ['id', 'payment_ref', 'email'] } }, confirmed: true });
});
test('customer reviews inert record text before confirming import, including on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { card, requests, caseId } = await setup(page);
  await card.getByRole('combobox', { name: 'Linked evidence case', exact: true }).selectOption(caseId);
  await expect(card.getByRole('button', { name: 'Import reviewed records' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Preview linked records' }).click();
  await expect(card).toContainText('<img src=x onerror=alert(1)>'); await expect(card.locator('img')).toHaveCount(0);
  expect(requests.at(-1)).toEqual({ action: 'preview_records', caseId });
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await card.getByRole('button', { name: 'Import reviewed records' }).click();
  expect(requests.at(-1)).toEqual({ action: 'import_records', caseId, previewId: '12345678-1234-4234-8234-123456789012', confirmed: true });
  await expect(page.getByRole('heading', { name: 'Missing ticket', exact: true })).toBeVisible();
});
test('changed mapping blocks preview until saved and stale-preview errors remain actionable', async ({ page }) => {
  const { card, caseId } = await setup(page);
  await card.getByRole('combobox', { name: 'Linked evidence case', exact: true }).selectOption(caseId);
  await card.getByRole('combobox', { name: 'Stored Stripe ID type', exact: true }).selectOption('charge');
  await expect(card.getByRole('button', { name: 'Preview linked records' })).toBeDisabled();
  await card.getByRole('button', { name: 'Save evidence mapping' }).click();
  await card.getByRole('button', { name: 'Preview linked records' }).click();
  await page.route('**/api/providers/evidence', async route => route.request().postDataJSON()?.action === 'import_records' ? route.fulfill({ status: 409, json: { error: 'Preview these records again before importing.' } }) : route.fallback());
  await card.getByRole('button', { name: 'Import reviewed records' }).click();
  await expect(card.getByRole('alert')).toContainText('Preview these records again');
  await expect(card.getByRole('button', { name: 'Preview linked records' })).toBeEnabled();
});
