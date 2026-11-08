// Recheck raw outputs without another model call; raw files retain their initial signals.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkTicketReport } from './ticket-regressions.mjs';

const directory = 'docs/evaluation/prompt-runs';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const batch = JSON.parse(readFileSync(`${directory}/summary.json`, 'utf8')).batch;
const rows = readdirSync(directory).filter(file => /^ATM-.*\.json$/.test(file)).sort().map(file => {
  const bytes = readFileSync(`${directory}/${file}`);
  const saved = JSON.parse(bytes);
  if (saved.batch !== batch) return null;
  const retrieved = new Set(saved.run.events.filter(event => event.type === 'tool_completed').flatMap(event => event.evidenceIds || []));
  const available = new Set(saved.evidence.map(record => record.id));
  const occurrences = [...saved.draft.content.matchAll(/(?<!\\)\[([^\[\]\r\n]+)\]/g)].map(match => match[1]);
  const references = new Set([...saved.draft.analysis.evidenceIds, ...occurrences, ...saved.draft.analysis.findings.flatMap(finding => finding.evidenceIds)]);
  return {
    file, artifactSha256: sha256(bytes), order: saved.order, repeat: saved.repeat, runId: saved.run.id,
    status: saved.run.status, assessment: saved.draft.analysis.assessment,
    citationOccurrences: occurrences.length, uniqueReferences: references.size,
    unresolvedOrUnretrieved: [...references].filter(id => !available.has(id) || !retrieved.has(id)),
    gaps: saved.draft.analysis.gaps.length, modelCalls: saved.draft.analysis.metrics.modelCalls,
    issues: checkTicketReport(saved),
  };
}).filter(Boolean);
if (!rows.length) throw new Error('No live prompt evaluation runs found.');
const out = {
  note: 'Current fixture-specific regression signals supersede initial raw regressionSignals; this is not a semantic accuracy score or human sign-off.',
  checkerSha256: sha256(readFileSync('docs/evaluation/ticket-regressions.mjs')),
  batch,
  runs: rows.length, completed: rows.filter(row => row.status === 'completed').length,
  citationOccurrences: rows.reduce((sum, row) => sum + row.citationOccurrences, 0),
  uniqueReferencesSummedPerRun: rows.reduce((sum, row) => sum + row.uniqueReferences, 0),
  unresolvedOrUnretrieved: rows.flatMap(row => row.unresolvedOrUnretrieved).length, rows,
};
writeFileSync(`${directory}/regression-audit.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
if (out.unresolvedOrUnretrieved || out.completed !== out.runs) process.exitCode = 1;
