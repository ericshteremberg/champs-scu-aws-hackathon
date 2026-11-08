import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

let stage = 'authentication';
async function main() {
  const base = 'https://causality-hackathon-dev.slidah60.workers.dev';
  const password = readFileSync('.dev-worker-access.txt', 'utf8').match(/^Password: (.+)$/m)?.[1];
  assert.ok(password);
  const Authorization = `Basic ${Buffer.from(`dev:${password}`).toString('base64')}`;
  assert.equal((await fetch(`${base}/api/providers`)).status, 401);
  const getStatus = async () => {
    const response = await fetch(`${base}/api/providers`, { headers: { Authorization } });
    assert.equal(response.status, 200);
    return (await response.json()).imap;
  };
  const initial = await getStatus(); assert.equal(initial.configured, true);
  const invalid = { action: 'connect', settings: { email: 'synthetic@example.test', host: '127.0.0.1', password: 'synthetic-not-a-real-mailbox-password', folders: ['INBOX'] }, confirmed: true };
  const post = (Origin, body) => fetch(`${base}/api/providers/imap`, { method: 'POST', headers: { Authorization, Origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  stage = 'origin and input rejection';
  assert.equal((await post('https://untrusted.example', invalid)).status, 403);
  const rejected = await post(base, invalid); assert.equal(rejected.status, 400); assert.equal((await rejected.json()).code, 'invalid_request');
  assert.equal((await post(base, { action: 'send' })).status, 400);
  assert.deepEqual(await getStatus(), initial);
  if (initial.connection && initial.connection.status !== 'disconnected') {
    console.log('PASS: IMAP status and rejected-input boundary. Existing customer connection preserved; setup UI was not exercised.');
    return;
  }
  stage = 'hosted setup form';
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
  try {
    const context = await browser.newContext({ httpCredentials: { username: 'dev', password, origin: base }, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.name));
    await page.goto(`${base}/workspace?view=integrations`);
    const card = page.getByRole('article', { name: 'Other email IMAP connection' });
    await card.getByRole('button', { name: 'Connect other email' }).click();
    await expect(card.getByRole('button', { name: 'Test and connect mailbox' })).toBeDisabled();
    await card.getByLabel('Mailbox email', { exact: true }).fill(invalid.settings.email);
    await card.getByLabel('Incoming IMAP server').fill(invalid.settings.host);
    await card.getByLabel('Mailbox or app password').fill(invalid.settings.password);
    await card.getByRole('checkbox').check();
    const reply = page.waitForResponse(r => r.url() === `${base}/api/providers/imap` && r.request().method() === 'POST');
    await card.getByRole('button', { name: 'Test and connect mailbox' }).click();
    assert.equal((await reply).status(), 400);
    await expect(card.getByRole('alert')).toBeVisible();
    await expect(card.getByLabel('Mailbox or app password')).toHaveValue('');
    assert.deepEqual(await getStatus(), initial);
    await card.getByRole('button', { name: 'Cancel setup' }).click();
    await page.reload();
    await card.getByRole('button', { name: 'Connect other email' }).click();
    await card.getByLabel('Mailbox email', { exact: true }).fill('');
    await card.getByLabel('Incoming IMAP server').fill('');
    mkdirSync('.aws-build', { recursive: true });
    await card.screenshot({ path: '.aws-build/imap-hosted-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await card.screenshot({ path: '.aws-build/imap-hosted-mobile.png' });
    assert.deepEqual(errors, []);
    const report = { verifiedAt: new Date().toISOString(), authenticatedAwsStatus: true, crossOriginRejected: true, invalidHostRejected: true, sendRejected: true, customerConnectionUnchanged: true, consentRequired: true, passwordCleared: true, mobileLayout: true, realMailboxLoginTested: false, mailboxRead: false };
    writeFileSync('.aws-build/imap-hosted-smoke.json', JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: hosted IMAP form, AWS status, origin/input rejection, consent control, password clearing and mobile layout. No mailbox login or read attempted.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(JSON.stringify({ test: 'imap-smoke', passed: false, stage, errorType: error?.name || 'Error' })); process.exitCode = 1; });
