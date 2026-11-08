// Records the actual local Causality sample workflow. No deployed access or AWS calls.
// First: npm run build; npm run db:migrate:local; npm start -- --port 8788
// Then: node docs/evaluation/capture-rehearsal.mjs
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:8788';
const output = 'docs/evaluation/artifacts';
await mkdir(output, { recursive: true });
const startedAt = new Date().toISOString();
const user = `rehearsal-${crypto.randomUUID()}`;
const headers = {
  'oai-authenticated-user-id': user,
  'oai-authenticated-user-email': `${user}@example.test`,
  'oai-authenticated-user-full-name': 'Synthetic Demo Reviewer',
  'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
};
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  baseURL: base, extraHTTPHeaders: headers, viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: output, size: { width: 1440, height: 1000 } }, acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const steps = [];
page.on('pageerror', error => errors.push(error.message));
const began = Date.now();
async function shot(name, description) {
  await expect(page.locator('.cw-toast')).toHaveCount(0, { timeout: 10000 });
  if (name.endsWith('-approved')) {
    await page.getByRole('heading', { name: 'Approved for submission', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  } else if (name.endsWith('-report')) {
    await page.getByRole('heading', { name: 'The case, assembled.', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }
  steps.push({ elapsedMs: Date.now() - began, description });
  await page.screenshot({ path: `${output}/${name}.png` });
  await page.waitForTimeout(1500); // Readable pause in the backup footage.
}
try {
  for (const data of [{ action: 'createWorkspace', name: 'Fictional sample rehearsal' }, { action: 'seedDemo' }]) {
    const response = await context.request.post(`${base}/api/workspace`, { headers: { Origin: base }, data });
    expect(response.status()).toBe(200);
  }
  // The compatibility Worker has no /api/runtime endpoint; verify the built bindings.
  const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
  expect(config.vars?.DATA_BACKEND).not.toBe('aws');
  expect(config.d1_databases?.length).toBeGreaterThan(0);
  const runtime = { storage: 'local D1/R2 compatibility', inference: 'deterministic sample' };
  const state = await (await context.request.get(`${base}/api/workspace`)).json();
  await page.route('**/api/investigations', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: { config: { bedrockConfigured: false, merchantConfigured: false, archiveConfigured: false, region: 'us-east-1' } } });
  });
  const runs = [];
  for (const order of ['ATM-1042', 'ATM-1043', 'ATM-1044']) {
    const item = state.cases.find(value => value.orderRef === order);
    await page.goto(`/workspace?view=cases&case=${encodeURIComponent(item.id)}`);
    const start = page.getByRole('button', { name: 'Run sample investigation', exact: true });
    await expect(start).toBeVisible();
    await start.click();
    await expect(page.getByRole('heading', { name: 'Investigation complete', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Report', exact: true }).click();
    await expect(page.getByText('Deterministic sample. No AWS model was called.', { exact: true })).toBeVisible();
    const result = await (await context.request.get(`${base}/api/investigations?caseId=${encodeURIComponent(item.id)}`)).json();
    const updated = await (await context.request.get(`${base}/api/workspace`)).json();
    const assessment = updated.cases.find(value => value.id === item.id).draft.analysis.assessment;
    expect(assessment).toBe({ 'ATM-1042': 'supported', 'ATM-1043': 'mixed', 'ATM-1044': 'insufficient' }[order]);
    runs.push({ order, runId: result.run.id, mode: result.run.mode, assessment });
    await shot(`${order}-report`, `${order}: deterministic sample report; synthetic inputs`);
    if (order !== 'ATM-1042') continue;
    await page.locator('.cw-citation').filter({ hasText: 'Customer acknowledged finding both tickets' }).first().click();
    await expect(page.locator('#case-source-heading')).toHaveText('Customer acknowledged finding both tickets');
    await shot('ATM-1042-source', 'Inspect the original fictional customer acknowledgement');
    await page.getByRole('tab', { name: 'Report', exact: true }).click();
    const draft = page.getByRole('textbox', { name: /Merchant response draft/ });
    await draft.fill(`${await draft.inputValue()}\n\nReviewer note: customer acknowledged account access; email acceptance does not establish inbox delivery or attendance.`);
    await expect(page.getByRole('button', { name: 'Approve draft', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('button', { name: 'Approve draft', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approved for submission', exact: true })).toBeVisible();
    await shot('ATM-1042-approved', 'Save the reviewer edit and approve its exact revision; sample remains non-submittable');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    const exported = await download;
    await exported.saveAs(`${output}/ATM-1042-reviewed-sample.txt`);
    expect(await readFile(`${output}/ATM-1042-reviewed-sample.txt`, 'utf8')).toContain('SYNTHETIC SAMPLE: NOT FOR SUBMISSION');
  }
  expect(errors).toEqual([]);
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const sourceFiles = git(['ls-files', 'app', 'components', 'lib', 'worker', 'db', 'drizzle', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts']).split('\n').filter(Boolean);
  const digest = createHash('sha256');
  for (const file of sourceFiles) digest.update(file + '\0').update(await readFile(file)).update('\0');
  const manifest = {
    startedAt, finishedAt: new Date().toISOString(), applicationUrl: base,
    applicationCommit: git(['rev-parse', 'HEAD']), sourceTreeSha256: digest.digest('hex'),
    sourceTreeHashMethod: 'SHA-256 of sorted git ls-files path + NUL + file bytes + NUL for the application paths listed in capture-rehearsal.mjs',
    applicationDiff: git(['diff', 'HEAD', '--', ...sourceFiles]),
    mode: 'deterministic sample', inputs: 'Fictional bundled ticket fixtures; isolated local workspace',
    runtime, runs, steps, pageErrors: errors,
    video: 'causality-local-sample.webm', narration: 'none; silent workflow capture',
    limitation: 'Local Sites compatibility storage. No live Bedrock, AWS bridge, S3 archive or production connector is exercised.',
  };
  await context.close();
  const video = await page.video().path();
  await rename(video, `${output}/${manifest.video}`);
  await writeFile(`${output}/rehearsal.json`, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ runs, screenshots: 5, pageErrors: errors.length, video: `${output}/${manifest.video}` }));
} finally {
  await browser.close();
}
