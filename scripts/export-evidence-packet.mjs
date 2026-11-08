// Offline packet export. Never contacts Stripe, AWS or a download URL.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index++) {
  const name = args[index];
  if (name === '--no-screenshots') { options.noScreenshots = true; continue; }
  if (!['--input', '--demo', '--output', '--files'].includes(name) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: npm run packet:export -- (--input export.json | --demo ATM-1042) --output NEW_DIRECTORY [--files files.json] [--no-screenshots]');
  if (options[name.slice(2)]) throw new Error(`Duplicate option ${name}`);
  options[name.slice(2)] = args[++index];
}
if (!options.output || Boolean(options.input) === Boolean(options.demo)) throw new Error('Provide exactly one --input or --demo and a new --output directory.');
await mkdir('.aws-build', { recursive: true });
const bundle = resolve(`.aws-build/packet-core-${process.pid}.mjs`);
await build({ stdin: { contents: "export * from './lib/investigation/facts.ts'; export { localEvidence } from './aws/investigations.ts'; export { TICKET_DEMO_CASES } from './lib/ticket-demo.ts'; export { validateUpload } from './lib/server/uploads.ts';", resolveDir: process.cwd(), sourcefile: 'packet-entry.ts' }, bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external', outfile: bundle, logLevel: 'warning' });
const { buildFactInventory, defaultPresentation, renderFactReport, localEvidence, TICKET_DEMO_CASES, validateUpload } = await import(pathToFileURL(bundle).href);
const scalar = z.union([z.string().max(24000), z.number().finite(), z.boolean(), z.null()]);
const evidenceSchema = z.object({ id: z.string().min(1).max(240).regex(/^[^\[\]\r\n]+$/), caseId: z.string().min(1), source: z.enum(['stripe', 'gmail', 'database', 'policy', 'manual']), title: z.string().max(240), content: z.string().max(24000), occurredAt: z.string().datetime({ offset: true }), reference: z.string().max(1000), fileName: z.string().max(255).optional(), mimeType: z.string().max(160).optional(), provenance: z.object({ section: z.string(), sourceMode: z.string(), originalSourceId: z.string().optional(), fields: z.record(z.string(), scalar), limitations: z.array(z.string().max(3000)).max(30) }).optional() });
const caseSchema = z.object({ id: z.string().min(1).max(200), title: z.string().max(240), source: z.enum(['demo', 'manual', 'stripe', 'merchant']), reason: z.string().max(6000), orderRef: z.string().max(240), amount: z.number().int().nonnegative().safe(), currency: z.string().regex(/^[a-z]{3}$/i) });
let item; let records; let importedDraft;
if (options.demo) {
  item = TICKET_DEMO_CASES.find(record => record.orderRef === options.demo);
  if (!item) throw new Error('Choose one fictional ticket case: ATM-1042, ATM-1043, ATM-1044.');
  records = item.evidence;
} else {
  const bytes = await readFile(options.input);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Input exceeds 4 MB. Narrow the case export.');
  const parsed = JSON.parse(bytes);
  item = caseSchema.parse(parsed.case);
  records = z.array(evidenceSchema).max(90).parse(parsed.evidence);
  importedDraft = parsed.draft || parsed.response;
  if (records.some(record => record.caseId !== item.id) || new Set(records.map(record => record.id)).size !== records.length) throw new Error('Evidence must belong to this case and have unique IDs.');
}
const sections = ['summary', 'order', 'tickets', 'delivery', 'history', 'support', 'attendance', 'policy'];
const envelopes = sections.map(section => localEvidence(item, records, section));
const inventory = buildFactInventory(item, envelopes);
const report = renderFactReport(item, inventory, defaultPresentation(inventory), { durationMs: 0, toolCalls: 8, recordCount: records.length, modelCalls: 0 });
const selected = new Set(inventory.facts.filter(fact => inventory.packetFactIds.includes(fact.id)).flatMap(fact => fact.evidenceIds));
const mapping = options.files ? z.record(z.string(), z.string()).parse(JSON.parse(await readFile(options.files, 'utf8'))) : {};
for (const id of Object.keys(mapping)) if (!selected.has(id)) throw new Error(`Original attachment ${id} is not linked to a selected supporting fact. Keep it in internal review until a fact rule supports its use.`);
const root = resolve(options.output);
await mkdir(root); // Never overwrite an existing packet or silently replace evidence.
await mkdir(join(root, 'submission'));
await mkdir(join(root, 'submission', 'exhibits'));
await mkdir(join(root, 'internal-review'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const exhibitManifest = [];
let browser;
try {
  if (!options.noScreenshots && selected.size) {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  }
  for (const [index, record] of records.filter(record => selected.has(record.id)).entries()) {
    const name = String(index + 1).padStart(3, '0');
    const prefix = `submission/exhibits/${name}`;
    let text = `SOURCE TRANSCRIPT — NOT AN ORIGINAL SCREENSHOT\n${record.title}\nEvidence ID: ${record.id}\nRecorded at: ${record.occurredAt}\nReference: ${record.reference}\n\n${record.content || 'Original file requires manual inspection; contents were not extracted.'}\n\nSTRUCTURED SOURCE FIELDS\n${JSON.stringify(record.provenance?.fields || {}, null, 2)}\n\nSOURCE QUALIFICATIONS\n${(record.provenance?.limitations || []).join('\n')}\n`;
    text = text.trimEnd() + '\n';
    await writeFile(join(root, `${prefix}-source.txt`), text, { mode: 0o600 });
    const exhibit = { evidenceId: record.id, reference: record.reference, text: `${prefix}-source.txt`, textSha256: sha256(text), kind: 'source_transcript', ...(record.fileName ? { originalFileName: record.fileName, originalStatus: mapping[record.id] ? 'supplied locally' : 'missing; not fetched automatically' } : {}) };
    if (mapping[record.id]) {
      const file = await realpath(mapping[record.id]);
      if (!(await stat(file)).isFile() || (await stat(file)).size > 10 * 1024 * 1024) throw new Error('Original evidence must be a file of at most 10 MB.');
      const bytes = await readFile(file);
      const checked = validateUpload(record.fileName || file, record.mimeType || '', bytes);
      if (record.mimeType && checked.mimeType !== record.mimeType) throw new Error(`Original file type mismatch for ${record.id}`);
      const target = `${prefix}-original${extname(checked.fileName).toLowerCase()}`;
      await copyFile(file, join(root, target));
      Object.assign(exhibit, { original: target, originalSha256: sha256(bytes), originalKind: checked.mimeType.startsWith('image/') ? 'original_image_supplied_by_operator' : 'original_file_supplied_by_operator' });
    }
    if (browser) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, offline: true });
      const page = await context.newPage();
      await page.setContent(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:18px/1.5 sans-serif;padding:36px;background:white;color:#111}pre{white-space:pre-wrap;overflow-wrap:anywhere}header{font-weight:bold;border:2px solid #555;padding:12px}</style></head><body><header>RENDERED SOURCE TRANSCRIPT — NOT AN ORIGINAL SCREENSHOT${inventory.synthetic ? ' — FICTIONAL SAMPLE' : ''}</header><pre>${escape(text.slice(0, 6000))}${text.length > 6000 ? '\n[Display excerpt; full text is in the accompanying source.txt.]' : ''}</pre></body></html>`);
      await page.screenshot({ path: join(root, `${prefix}-transcript.png`), fullPage: true });
      Object.assign(exhibit, { screenshot: `${prefix}-transcript.png`, screenshotKind: 'rendered_transcript_not_original', screenshotSha256: sha256(await readFile(join(root, `${prefix}-transcript.png`))) });
      await context.close();
    }
    exhibitManifest.push(exhibit);
  }
  const response = report.content + '\n';
  await writeFile(join(root, 'submission', 'response.txt'), response, { mode: 0o600 });
  const links = exhibitManifest.map(exhibit => `<li>${escape(exhibit.evidenceId)}: <a href="exhibits/${escape(exhibit.text.split('/').at(-1))}">Source text</a>${exhibit.screenshot ? ` · <a href="exhibits/${escape(exhibit.screenshot.split('/').at(-1))}">Rendered transcript</a>` : ''}${exhibit.original ? ` · <a href="exhibits/${escape(exhibit.original.split('/').at(-1))}">Original attachment</a>` : ''}</li>`).join('');
  await writeFile(join(root, 'submission', 'report.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Causality evidence packet</title><style>body{font:16px/1.6 sans-serif;max-width:1000px;margin:40px auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Prepared challenge packet — review required</h1><pre>${escape(response)}</pre><h2>Selected supporting exhibits</h2><ul>${links}</ul></body></html>`, { mode: 0o600 });
  await writeFile(join(root, 'internal-review', 'inventory.json'), JSON.stringify({ case: item, inventory, evidence: records, importedDraft: importedDraft || null }, null, 2) + '\n', { mode: 0o600 });
  const manifest = { version: 1, caseId: item.id, appealPolicy: 'challenge_all', preparedAt: new Date().toISOString(), synthetic: inventory.synthetic,
    status: inventory.packetFactIds.length ? 'review_required' : 'needs_affirmative_evidence', submitted: false,
    assessment: inventory.assessment, selectedFactIds: inventory.packetFactIds, selectedEvidenceIds: [...selected], excludedEvidenceIds: records.filter(record => !selected.has(record.id)).map(record => record.id),
    modelCalls: 0, responseSha256: sha256(response), exhibits: exhibitManifest, screenshotsRequested: !options.noScreenshots,
    reviewNotes: ['Submission contains only code-selected supporting facts and their necessary qualifications.', 'Internal review contains the full inventory, counterevidence, gaps and original source metadata; it is not an outgoing submission document.', 'Imported approval metadata and local file provenance are not independently authenticated. The rebuilt packet requires review.', 'Rendered transcripts are not original screenshots. Original files are included only when supplied explicitly and byte-validated. No outcome is guaranteed.'] };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await writeFile(join(root, 'README.txt'), 'CAUSALITY PREPARED PACKET — NOT SUBMITTED\nReview submission/report.html and its selected exhibits.\nKeep internal-review/ and manifest.json for audit, not as the outgoing evidence letter.\nOriginal screenshots are distinct from rendered transcript images.\nNo payment-provider API is called. No approval is inferred from an input file.\n', { mode: 0o600 });
  console.log(JSON.stringify({ output: root, status: manifest.status, assessment: inventory.assessment, selectedFacts: inventory.packetFactIds.length, exhibits: exhibitManifest.length, submitted: false }));
} finally { await browser?.close(); }
