import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

let checkStage = 'initialization';
async function main() {
// Exercises the actual hosted bridge, app secret and pending state, but does not
// authorize a customer account, exchange a code or read merchant database rows.
const provider = process.argv[2] || 'supabase';
assert.ok(['supabase', 'stripe', 'gmail'].includes(provider), 'Choose supabase, stripe or gmail.');
const providerOrigin = { stripe: 'https://marketplace.stripe.com', supabase: 'https://api.supabase.com', gmail: 'https://accounts.google.com' }[provider];
const label = { stripe: 'Stripe', supabase: 'Supabase', gmail: 'Gmail' }[provider];
const base = 'https://causality-hackathon-dev.slidah60.workers.dev';
const password = readFileSync('.dev-worker-access.txt', 'utf8').match(/^Password: (.+)$/m)?.[1];
assert.ok(password, 'Private development access is required.');
const Authorization = `Basic ${Buffer.from(`dev:${password}`).toString('base64')}`;
assert.equal((await fetch(`${base}/api/providers`)).status, 401);
const initial = await fetch(`${base}/api/providers`, { headers: { Authorization } });
assert.equal(initial.status, 200, 'The hosted AWS provider status must be reachable.');
const status = await initial.json();
assert.equal(status[provider].configured, true);

if (status[provider].connection && (status[provider].connection.status !== 'disconnected' || status[provider].connection.revocationPending)) {
  console.log(`SKIP: ${label} already has a customer authorization or pending revocation. Preserved that connection; start/cancel was not tested.`);
  return;
}
checkStage = 'origin rejection';
const rejected = await fetch(`${base}/api/providers/${provider}/start`, { method: 'POST', headers: { Authorization, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(rejected.status, 403);

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
try {
  const context = await browser.newContext({ httpCredentials: { username: 'dev', password, origin: base }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  let authorization;
  await page.route(`${providerOrigin}/**`, async route => {
    authorization = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: '<h1>Authorization navigation intercepted for a start/cancel test.</h1>' });
  });
  checkStage = 'load Connections';
  await page.goto(`${base}/workspace?view=integrations`);
  const panel = page.getByRole('region', { name: 'Business account connections' });
  await expect(panel.getByRole('button', { name: `Connect ${label}`, exact: true })).toBeEnabled({ timeout: 30000 });
  checkStage = 'start authorization';
  await panel.getByRole('button', { name: `Connect ${label}`, exact: true }).click();
  await expect(page).toHaveURL(url => url.origin === providerOrigin, { timeout: 30000 });
  assert.ok(authorization);
  assert.equal(authorization.searchParams.get('redirect_uri'), `${base}/api/providers/${provider}/callback`);
  if (provider !== 'stripe') assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  if (provider === 'gmail') {
    assert.equal(authorization.pathname, '/o/oauth2/v2/auth');
    assert.equal(authorization.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
    assert.equal(authorization.searchParams.get('access_type'), 'offline');
    assert.equal(authorization.searchParams.get('prompt'), 'consent');
    assert.ok(authorization.searchParams.get('client_id')?.endsWith('.apps.googleusercontent.com'));
    assert.ok(authorization.searchParams.get('code_challenge'));
  }
  const cookie = (await context.cookies(base)).find(c => c.name === `__Host-causality-${provider}`);
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax');
  const callback = new URL(`${base}/api/providers/${provider}/callback`);
  callback.search = new URLSearchParams({ state: authorization.searchParams.get('state'), error: 'access_denied' }).toString();
  checkStage = 'denied callback';
  const response = await page.goto(callback.toString());
  assert.ok(response?.ok());
  await expect(panel.getByRole('status')).toContainText(provider === 'supabase' ? 'Authorization was canceled' : `${label} authorization was canceled`, { timeout: 30000 });
  assert.ok(!(await context.cookies(base)).some(c => c.name === cookie.name));
  // Restore only the original synthetic-flow browser cookie to isolate state replay protection.
  checkStage = 'callback replay';
  await context.addCookies([cookie]);
  await page.goto(callback.toString());
  await expect(panel.getByRole('status')).toContainText('expired or belongs to another browser', { timeout: 30000 });
  const after = await (await fetch(`${base}/api/providers`, { headers: { Authorization } })).json();
  assert.equal(after[provider].connection.status, 'disconnected');
  let readAction = { action: provider === 'stripe' ? 'verify' : 'projects' };
  if (provider === 'gmail') {
    const workspaceResponse = await fetch(`${base}/api/workspace`, { headers: { Authorization } });
    assert.equal(workspaceResponse.status, 200);
    const workspace = await workspaceResponse.json();
    const openCase = workspace.cases.find(c => ['needs_review', 'investigating', 'ready'].includes(c.status));
    assert.ok(openCase, 'An existing open case is required for the disconnected Gmail read check.');
    readAction = { action: 'search', caseId: openCase.id };
  }
  const read = await fetch(`${base}/api/providers/${provider}`, { method: 'POST', headers: { Authorization, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(readAction) });
  assert.equal(read.status, 409);
  if (provider === 'gmail') assert.equal((await read.json()).code, 'provider_disconnected');
  assert.deepEqual(errors, []);
  mkdirSync('.aws-build', { recursive: true });
  await page.screenshot({ path: `.aws-build/${provider}-connections-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `.aws-build/${provider}-connections-mobile.png`, fullPage: true });
  writeFileSync(`.aws-build/${provider}-oauth-smoke.json`, JSON.stringify({ provider, verifiedAt: new Date().toISOString(), authenticatedAwsStatus: true, crossOriginRejected: true, realAppSecretLoaded: true, browserCookieVerified: true, deniedCallback: true, replayRejected: true, disconnectedReadDenied: true, customerConsentTested: false, customerRowsRead: false }, null, 2) + '\n');
  console.log(`PASS: hosted ${label} start, secure browser cookie, denied callback, replay rejection and disconnected read rejection. Customer consent/token exchange were not attempted.`);
} finally { await browser.close(); }

}
main().catch(error => {
  // Assertion/Playwright messages can contain the private invitation URL or state.
  console.error(JSON.stringify({ test: 'provider-oauth-smoke', passed: false, stage: checkStage, errorType: error?.name || 'Error' }));
  process.exitCode = 1;
});
