import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This recorder clicks the real UI against an isolated synthetic database.
// The only injected elements are a visible cursor and click feedback.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.argv[2] || '/tmp/casework-demo');
await mkdir(out, { recursive: true });
const api = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
  import { createApp } from './server/app.ts';
  import { loadConfig } from './server/config.ts';
  const workspace = createApp(loadConfig({ HOST: '127.0.0.1', PORT: '3108',
    INVESTIGATION_MODE: 'demo', APP_ORIGIN: 'http://127.0.0.1:5188', DATABASE_PATH: ${JSON.stringify(resolve(out, 'capture.sqlite'))},
    DEMO_STEP_MS: '350' }));
  const server = workspace.app.listen(3108, '127.0.0.1');
  process.on('SIGTERM', async () => { server.close(); await workspace.close(); process.exit(); });
`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
api.stderr.on('data', data => process.stderr.write(data));
let vite, browser, context;
try {
  vite = await createServer({ root, server: { host: '127.0.0.1', port: 5188,
    strictPort: true, proxy: { '/api': 'http://127.0.0.1:3108' } } });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: 1600, height: 900 } },
    reducedMotion: 'reduce', acceptDownloads: true });
  await context.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const cursor = document.createElement('div');
      cursor.id = 'demo-cursor';
      cursor.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:34px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px #0005);transform:translate(1450px,750px)';
      cursor.innerHTML = '<svg width="28" height="34" viewBox="0 0 28 34"><path d="M3 2 L3 27 L10 21 L16 32 L21 29 L15 19 L25 18 Z" fill="#171a18" stroke="white" stroke-width="2.5" stroke-linejoin="round"/></svg>';
      document.body.append(cursor);
      addEventListener('mousemove', e => { cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
      addEventListener('mousedown', e => {
        const ring = document.createElement('div');
        ring.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border:3px solid #df824a;border-radius:50%;pointer-events:none;z-index:2147483646;background:#df824a20`;
        document.body.append(ring);
        ring.animate([{transform:'scale(.5)',opacity:1},{transform:'scale(1.5)',opacity:0}], {duration:450}).finished.then(() => ring.remove());
      });
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5188');
  await expect(page.getByRole('button', { name: /CW-1042/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const started = Date.now();
  const marks = [];
  const mark = label => { const item = { at: (Date.now() - started) / 1000, label }; marks.push(item); console.log(JSON.stringify(item)); };
  const pause = ms => page.waitForTimeout(ms);
  async function click(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('Target has no visible bounds');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
    await pause(160);
    await page.mouse.down(); await pause(90); await page.mouse.up();
    await pause(350);
  }
  mark('Select one disputed transaction');
  await pause(1400);
  await click(page.getByRole('button', { name: /CW-1042/ }));
  await pause(1100);
  mark('One click starts the automated investigation');
  await click(page.getByRole('button', { name: 'Investigate case', exact: true }));
  await expect(page.getByRole('heading', { name: 'Evidence supports a response.' })).toBeVisible({ timeout: 15000 });
  mark('Records gathered. Findings prepared automatically.');
  await pause(1600);
  await page.screenshot({ path: resolve(out, 'findings.png') });
  await click(page.getByRole('tab', { name: /Evidence/ }));
  await pause(700);
  await click(page.getByRole('button', { name: /Payment captured/ }));
  await pause(1600);
  await page.keyboard.press('Escape');
  await pause(400);
  mark('Trace every finding to its original evidence');
  const acknowledgment = page.getByRole('button', { name: /Customer acknowledged/ });
  await click(acknowledgment);
  await pause(2100);
  await page.screenshot({ path: resolve(out, 'source.png') });
  await page.keyboard.press('Escape');
  await click(page.getByRole('tab', { name: 'Activity', exact: true }));
  await pause(1500);
  await page.screenshot({ path: resolve(out, 'activity.png') });
  mark('A sourced response is already drafted');
  await click(page.getByRole('tab', { name: 'Response', exact: true }));
  await pause(1700);
  await click(page.getByRole('checkbox'));
  await click(page.getByRole('button', { name: 'Save review', exact: true }));
  await expect(page.getByText('Review saved. Your response is ready to export.')).toBeVisible();
  mark('Review saved. Evidence packet ready.');
  await pause(1300);
  const downloadPromise = page.waitForEvent('download');
  await click(page.getByRole('button', { name: 'Export response', exact: true }));
  const download = await downloadPromise;
  await download.saveAs(resolve(out, 'sample-response.md'));
  await pause(1000);
  const jsonPromise = page.waitForEvent('download');
  await click(page.getByRole('button', { name: 'Evidence JSON', exact: true }));
  await (await jsonPromise).saveAs(resolve(out, 'sample-evidence.json'));
  const response = await page.request.get('http://127.0.0.1:5188/api/cases/case_atm_1042');
  const saved = await response.json();
  if (saved.case.status !== 'reviewed' || !saved.latestRun.report.reviewedAt) throw new Error('Review persistence was not verified');
  await page.reload();
  await click(page.getByRole('button', { name: 'Reviewed', exact: true }));
  await expect(page.getByRole('button', { name: /CW-1042/ })).toBeVisible();
  mark('Saved case survives refresh');
  await pause(2300);
  await page.screenshot({ path: resolve(out, 'saved.png') });
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(resolve(out, 'capture.json'), JSON.stringify({ marks, sourceMode: 'synthetic', investigationMode: 'demo', savedStatus: saved.case.status, reviewedAt: saved.latestRun.report.reviewedAt, duration: (Date.now() - started) / 1000 }, null, 2));
  const video = page.video();
  await context.close(); context = null;
  await copyFile(await video.path(), resolve(out, 'screen-recording.webm'));
  console.log(`Recording verified: ${out}`);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (vite) await vite.close();
  api.kill('SIGTERM');
}
