import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

let stage = 'authentication';
async function main() {
  const base = 'https://causality-hackathon-dev.slidah60.workers.dev';
  const password = readFileSync('.dev-worker-access.txt', 'utf8').match(/^Password: (.+)$/m)?.[1]; assert.ok(password);
  const Authorization = `Basic ${Buffer.from(`dev:${password}`).toString('base64')}`;
  const get = async path => { const result = await fetch(`${base}${path}`, { headers: { Authorization } }); assert.equal(result.status, 200); return result.json(); };
  const post = (path, body, Origin = base) => fetch(`${base}${path}`, { method: 'POST', headers: { Authorization, Origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/api/providers/evidence`)).status, 401);
  const initial = await get('/api/providers'); const setup = await get('/api/providers/evidence');
  assert.ok(Array.isArray(setup.eligibleCaseIds)); assert.ok(Object.hasOwn(setup, 'mapping'));
  stage = 'rejected input and origin boundaries';
  assert.equal((await post('/api/providers/evidence', { action: 'stripe_disputes' }, 'https://untrusted.example')).status, 403);
  const forged = await post('/api/providers/evidence', { action: 'preview_records', caseId: 'synthetic_not_a_case', paymentRef: 'pi_browser_override' });
  assert.equal(forged.status, 400); assert.equal((await forged.json()).code, 'invalid_request');
  if (process.argv.includes('--stripe-read') && initial.stripe.connection?.status === 'authorized') {
    stage = 'Stripe customer read verification';
    const check = await post('/api/providers/stripe', { action: 'verify' });
    const value = await check.json();
    if (check.status !== 200) { console.log(JSON.stringify({ stage, httpStatus: check.status, code: String(value.code).replace(/[^a-z_]/g, '').slice(0, 80) })); throw new Error('Read check failed'); }
    assert.equal(value.disputeReadVerified, true);
    stage = 'Stripe customer dispute summaries';
    const list = await post('/api/providers/evidence', { action: 'stripe_disputes' });
    const records = await list.json();
    if (list.status !== 200) { console.log(JSON.stringify({ stage, httpStatus: list.status, code: String(records.code).replace(/[^a-z_]/g, '').slice(0, 80) })); throw new Error('List check failed'); }
    assert.ok(Array.isArray(records.disputes)); assert.ok(records.disputes.length <= 10);
    console.log(JSON.stringify({ stripeReadVerified: true, chargeReadVerified: value.chargeReadVerified, summariesReturned: records.disputes.length, moreAvailable: records.moreAvailable }));
  }
  stage = 'hosted evidence UI';
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
  try {
    const context = await browser.newContext({ httpCredentials: { username: 'dev', password, origin: base }, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.name));
    await page.goto(`${base}/workspace?view=integrations`);
    const card = page.getByRole('article', { name: 'Disputes and linked evidence' }); await expect(card).toBeVisible();
    if (initial.stripe.connection?.status === 'authorized') await expect(card.getByRole('button', { name: 'Load Stripe disputes' })).toBeEnabled();
    if (!initial.supabase.connection?.project) await expect(card.getByRole('combobox', { name: 'Order table', exact: true })).toBeDisabled();
    mkdirSync('.aws-build', { recursive: true });
    await card.screenshot({ path: '.aws-build/linked-evidence-hosted-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 }); await expect(card).toBeVisible();
    assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await card.screenshot({ path: '.aws-build/linked-evidence-hosted-mobile.png' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  assert.deepEqual((await get('/api/providers')).supabase, initial.supabase);
  console.log('PASS: hosted evidence UI, authentication and rejected-input boundaries. No project selected, mapping saved, dispute imported, database rows queried or Stripe response submitted.');
}
main().catch(() => { console.error(`FAIL at ${stage}. Provider data and credentials omitted.`); process.exitCode = 1; });
