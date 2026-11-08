import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

// Exercises the actual hosted bridge, app secret and pending state, but does not
// authorize a customer account, exchange a code or read merchant database rows.
const base = 'https://causality-hackathon-dev.slidah60.workers.dev';
const password = readFileSync('.dev-worker-access.txt', 'utf8').match(/^Password: (.+)$/m)?.[1];
assert.ok(password, 'Private development access is required.');
const Authorization = `Basic ${Buffer.from(`dev:${password}`).toString('base64')}`;
assert.equal((await fetch(`${base}/api/providers`)).status, 401);
const initial = await fetch(`${base}/api/providers`, { headers: { Authorization } });
assert.equal(initial.status, 200, 'The hosted AWS provider status must be reachable.');
const status = await initial.json();
assert.equal(status.supabase.configured, true);
assert.equal(status.stripe.configured, false);
assert.ok(!status.supabase.connection || (status.supabase.connection.status === 'disconnected' && !status.supabase.connection.revocationPending), 'Do not run this start/cancel check over an existing customer authorization.');
const rejected = await fetch(`${base}/api/providers/supabase/start`, { method: 'POST', headers: { Authorization, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(rejected.status, 403);

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
try {
  const context = await browser.newContext({ httpCredentials: { username: 'dev', password, origin: base }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  let authorization;
  await page.route('https://api.supabase.com/v1/oauth/authorize?**', async route => {
    authorization = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: '<h1>Authorization navigation intercepted for a start/cancel test.</h1>' });
  });
  await page.goto(`${base}/workspace?view=integrations`);
  const panel = page.getByRole('region', { name: 'Business account connections' });
  await expect(panel.getByRole('button', { name: 'Connect Supabase', exact: true })).toBeEnabled({ timeout: 30000 });
  await panel.getByRole('button', { name: 'Connect Supabase', exact: true }).click();
  await expect(page).toHaveURL(/api\.supabase\.com\/v1\/oauth\/authorize/, { timeout: 30000 });
  assert.ok(authorization);
  assert.equal(authorization.searchParams.get('redirect_uri'), `${base}/api/providers/supabase/callback`);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  const cookie = (await context.cookies(base)).find(c => c.name === '__Host-causality-supabase');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax');
  const callback = new URL(`${base}/api/providers/supabase/callback`);
  callback.search = new URLSearchParams({ state: authorization.searchParams.get('state'), error: 'access_denied' }).toString();
  const response = await page.goto(callback.toString());
  assert.ok(response?.ok());
  await expect(panel.getByRole('status')).toContainText('Authorization was canceled', { timeout: 30000 });
  assert.ok(!(await context.cookies(base)).some(c => c.name === cookie.name));
  // Restore only the original synthetic-flow browser cookie to isolate state replay protection.
  await context.addCookies([cookie]);
  await page.goto(callback.toString());
  await expect(panel.getByRole('status')).toContainText('expired or belongs to another browser', { timeout: 30000 });
  const after = await (await fetch(`${base}/api/providers`, { headers: { Authorization } })).json();
  assert.equal(after.supabase.connection.status, 'disconnected');
  const read = await fetch(`${base}/api/providers/supabase`, { method: 'POST', headers: { Authorization, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'projects' }) });
  assert.equal(read.status, 409);
  assert.deepEqual(errors, []);
  mkdirSync('.aws-build', { recursive: true });
  await page.screenshot({ path: '.aws-build/provider-connections-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.aws-build/provider-connections-mobile.png', fullPage: true });
  writeFileSync('.aws-build/provider-oauth-smoke.json', JSON.stringify({ verifiedAt: new Date().toISOString(), authenticatedAwsStatus: true, crossOriginRejected: true, realAppSecretLoaded: true, browserCookieVerified: true, deniedCallback: true, replayRejected: true, disconnectedReadDenied: true, customerConsentTested: false, customerRowsRead: false }, null, 2) + '\n');
  console.log('PASS: hosted Supabase start, secure browser cookie, denied callback, replay rejection and disconnected read rejection. Customer consent/token exchange were not attempted.');
} finally { await browser.close(); }
