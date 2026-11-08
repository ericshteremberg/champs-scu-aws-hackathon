// Offline reconstruction of the latest live inventory batch. No network or model calls.
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = 'docs/evaluation/inventory-runs';
const summary = JSON.parse(readFileSync(`${directory}/summary.json`, 'utf8'));
const bundle = resolve('.aws-build/inventory-audit.mjs');
await build({ stdin: { contents: "export * from './lib/investigation/facts.ts'; export { localEvidence } from './aws/investigations.ts';", resolveDir: process.cwd(), sourcefile: 'inventory-audit-entry.ts' }, bundle: true, packages: 'external', platform: 'node', target: 'node22', format: 'esm', outfile: bundle, logLevel: 'warning' });
const { buildFactInventory, renderFactReport, validatePresentation } = await import(pathToFileURL(bundle).href);
const { localEvidence } = await import(pathToFileURL(bundle).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sections = ['summary', 'order', 'tickets', 'delivery', 'history', 'support', 'attendance', 'policy'];
const rows = [];
for (const file of readdirSync(directory).filter(file => /^ATM-.*\.json$/.test(file)).sort()) {
  const bytes = readFileSync(`${directory}/${file}`); const saved = JSON.parse(bytes);
  if (saved.batch !== summary.batch) continue;
  const errors = [];
  const rebuilt = buildFactInventory(saved.case, sections.map(section => localEvidence(saved.case, saved.evidence, section)));
  let rendered;
  try {
    validatePresentation(saved.draft.analysis.presentation, rebuilt);
    rendered = renderFactReport(saved.case, rebuilt, saved.draft.analysis.presentation, saved.draft.analysis.metrics, saved.run.modelId);
  } catch { errors.push('invalid_presentation'); }
  if (JSON.stringify(rebuilt) !== JSON.stringify(saved.draft.analysis.factInventory)) errors.push('inventory_not_reproducible');
  if (rendered?.content !== saved.draft.content) errors.push('model_or_other_text_outside_code_renderer');
  if (saved.draft.analysis.claimControl !== 'code_generated') errors.push('claim_control_not_code_generated');
  if (saved.run.status !== 'completed' || !saved.sourceStable) errors.push('run_or_source_not_stable');
  const available = new Set(saved.evidence.map(record => record.id));
  const retrieved = new Set(saved.run.events.filter(event => event.type === 'tool_completed').flatMap(event => event.evidenceIds || []));
  const citations = [...saved.draft.content.matchAll(/(?<!\\)\[([^\[\]\r\n]+)\]/g)].map(match => match[1]);
  if (citations.some(id => !available.has(id) || !retrieved.has(id))) errors.push('foreign_or_unretrieved_citation');
  rows.push({ order: saved.order, repeat: saved.repeat, runId: saved.run.id, file, artifactSha256: hash(bytes),
    assessment: saved.draft.analysis.assessment, appealPolicy: rebuilt.appealPolicy,
    inventoryFacts: rebuilt.facts.length, selectedFacts: rebuilt.packetFactIds.length, outgoingCitationOccurrences: citations.length,
    gaps: rebuilt.gaps.length, modelCalls: saved.draft.analysis.metrics.modelCalls,
    readiness: rebuilt.packetFactIds.length ? 'review_required' : 'needs_affirmative_evidence', errors });
}
if (!rows.length) throw new Error('No runs from the latest batch.');
const out = { batch: summary.batch, note: 'Verifies mechanical claim/citation control against code and selected source fields; does not authenticate sources or establish real-world truth, completeness or a winning case.',
  sourceTreeSha256: summary.source.sourceTreeSha256, rows, passed: rows.every(row => row.errors.length === 0) };
writeFileSync(`${directory}/inventory-audit.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
if (!out.passed) process.exitCode = 1;
