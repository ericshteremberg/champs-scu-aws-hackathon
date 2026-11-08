import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const base = 'https://causality-hackathon-dev.slidah60.workers.dev';
let stage = 'load case';
async function main() {
  const caseId = process.env.CAUSALITY_SMOKE_CASE_ID;
  assert.ok(caseId, 'Set CAUSALITY_SMOKE_CASE_ID to an authorized existing case.');
  const password = readFileSync('.dev-worker-access.txt', 'utf8').match(/^Password: (.+)$/m)?.[1]; assert.ok(password);
  const headers = { Authorization: `Basic ${Buffer.from(`dev:${password}`).toString('base64')}` };
  const readCase = async () => { const r = await fetch(`${base}/api/workspace`, { headers }); assert.equal(r.status, 200); return (await r.json()).cases.find(c => c.id === caseId); };
  const before = await readCase(); assert.ok(before && before.source !== 'demo');
  const digest = c => createHash('sha256').update(JSON.stringify(c)).digest('hex');
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
  try {
    const context = await browser.newContext({ httpCredentials: { username: 'dev', password, origin: base }, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [], actions = [];
    page.on('pageerror', e => errors.push(e.name));
    page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/providers/')) { try { actions.push(r.postDataJSON().action); } catch { /* No request body logged. */ } } });
    stage = 'open connections';
    await page.goto(`${base}/workspace?view=integrations`);
    const collector = page.getByRole('article', { name: 'Get evidence from all providers' });
    stage = 'collect provider results';
    await collector.getByLabel('Case to collect evidence for').selectOption(caseId);
    await collector.getByRole('button', { name: 'Get evidence', exact: true }).click();
    await expect(collector.getByRole('button', { name: 'Get evidence', exact: true })).toBeEnabled({ timeout: 60000 });
    const outcomes = {};
    for (const provider of ['Stripe','Supabase','Resend','IMAP']) {
      const section = collector.getByRole('region', { name: `${provider} collection result` });
      await expect(section).toBeVisible(); outcomes[provider] = (await section.getByRole('heading').textContent()).split(': ').at(-1);
    }
    assert.ok(actions.includes('preview_case_payment') && actions.includes('find') && actions.includes('search'));
    mkdirSync('.aws-build', { recursive: true });
    await collector.screenshot({ path: '.aws-build/customer-evidence-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await collector.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await collector.screenshot({ path: '.aws-build/customer-evidence-mobile.png' });
    stage = 'customer lookup';
    const imap = page.getByRole('article', { name: 'Other email IMAP connection' });
    await imap.getByLabel('Case for IMAP evidence').scrollIntoViewIfNeeded();
    await imap.getByLabel('Case for IMAP evidence').selectOption(caseId);
    await imap.getByRole('button', { name: 'Find customer account in Supabase' }).click();
    await expect(imap.getByRole('button', { name: 'Look up customer', exact: true })).toBeEnabled();
    await imap.getByRole('button', { name: 'Look up customer', exact: true }).click();
    await expect(imap.getByRole('button', { name: /Use this email and search/ }).first()).toBeVisible();
    const accountMatches = await imap.getByRole('button', { name: /Use this email and search/ }).count();
    let savedResendVerified = false;
    if (process.env.CAUSALITY_EXPECT_SAVED_RESEND === '1') {
      stage = 'saved Resend preview';
      const resend = page.getByRole('article', { name: 'Resend email evidence' });
      await resend.getByLabel('Resend evidence case').selectOption(caseId);
      await expect(resend.getByRole('heading', { name: 'Saved case evidence, not reverified' })).toBeVisible({ timeout: 30000 });
      await expect(resend.getByRole('alert')).toHaveCount(0);
      await expect(resend.getByRole('button', { name: 'Attach to report' })).toHaveCount(0);
      await expect(resend).toContainText('Already attached.');
      await expect(collector).toContainText('Live record not reverified.');
      await resend.screenshot({ path: '.aws-build/resend-retained-mobile.png' });
      savedResendVerified = true;
    }
    stage = 'case unchanged';
    assert.equal(digest(await readCase()), digest(before));
    assert.equal(actions.some(a => /^(?:import|import_records|customer_select|customer_save_mapping|send)$/.test(a)), false);
    assert.deepEqual(errors, []);
    const report = { verifiedAt: new Date().toISOString(), outcomes, accountMatches, savedResendVerified, desktopMobilePassed: true, caseUnchanged: true, evidenceAttached: false, emailsSent: false };
    writeFileSync('.aws-build/customer-evidence-browser-live.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(JSON.stringify({ passed: false, stage, errorType: e?.name || 'Error', assertion: String(e?.message || '').split('\n')[0] })); process.exitCode = 1; });
