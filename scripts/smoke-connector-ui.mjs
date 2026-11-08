import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

// Uses the existing protected development preview and explicitly fictional sample cases.
const base = 'https://causality-hackathon-dev.slidah60.workers.dev';
const password = readFileSync('.dev-worker-access.txt', 'utf8').match(/^Password: (.+)$/m)?.[1];
if (!password) throw new Error('The ignored private development access file is required.');
const Authorization = 'Basic ' + Buffer.from(`dev:${password}`).toString('base64');
async function api(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization, ...(body ? { Origin: base, 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, `Development API ${path} returned ${response.status}`);
  return response.json();
}
assert.equal((await fetch(base + '/api/connectors')).status, 401);
assert.equal((await api('/api/runtime')).storage, 'aws');
const list = await api('/api/connectors');
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const results = [];
try {
  const context = await browser.newContext({ httpCredentials: { username: 'dev', password, origin: base }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  for (const template of list.templates) {
    const name = `${template.name} connector demo`;
    await page.goto(`${base}/workspace?view=integrations`);
    await page.getByText("Custom data sources", { exact: false }).click();
    const section = page.getByRole('region', { name: 'Evidence connectors' });
    const existing = list.connections.find(item => item.name === name && item.status === 'demo_ready' && JSON.stringify(item.manifest) === JSON.stringify(template.manifest));
    if (existing) {
      await section.locator('.cw-connector-row').filter({ has: page.getByText(name, { exact: true }) }).getByRole('button', { name: 'Installation files', exact: true }).click();
    } else {
      await section.getByRole('button', { name: 'Add evidence connector', exact: true }).click();
      await section.getByRole('button', { name: new RegExp(template.name) }).click();
      await section.getByLabel('Connection name', { exact: true }).fill(name);
      await section.getByRole('button', { name: 'Review mapping', exact: true }).click();
      await section.getByRole('checkbox', { name: /I have reviewed/ }).check();
      await section.getByRole('button', { name: 'Preview case access', exact: true }).click();
      await expect(section.getByText('Boundary checks passed', { exact: true })).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: `.aws-build/${template.id}-access-preview.png`, fullPage: true });
      await section.getByRole('button', { name: 'Save configuration', exact: true }).click();
    }
    await expect(section.getByText('Install connector', { exact: true })).toBeVisible({ timeout: 30000 });
    const download = page.waitForEvent('download');
    await section.getByRole('button', { name: 'manifest.json', exact: true }).click();
    const file = await download;
    const downloaded = JSON.parse(await readFile(await file.path(), 'utf8'));
    assert.deepEqual(downloaded, template.manifest);
    await section.getByRole('button', { name: 'Open sample investigation', exact: true }).click();
    await expect(page).toHaveURL(/view=cases/, { timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Investigate with AWS', exact: true })).toBeVisible({ timeout: 30000 });
    const caseId = new URL(page.url()).searchParams.get('case');
    const saved = (await api('/api/workspace')).cases.find(item => item.id === caseId);
    assert.ok(saved?.evidence.length > 0);
    assert.equal(saved.source, 'demo');
    assert.ok(saved.evidence.every(record => record.provenance?.sourceMode === 'synthetic'));
    results.push({ template: template.id, caseId, downloadedManifest: true });
    console.log(`PASS: published browser setup, DynamoDB save, download, and sample import for ${template.id}.`);
  }
  assert.deepEqual(errors, []);
  writeFileSync('.aws-build/connector-browser-smoke.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), url: base, results }, null, 2)}\n`);
} finally { await browser.close(); }
