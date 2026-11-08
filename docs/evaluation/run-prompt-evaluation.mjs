// Real Bedrock calls using this checkout's engine and the backend's evidence adapter.
// No deployment, Lambda invocation, workspace writes, approval, uploads or submission.
// Usage: node docs/evaluation/run-prompt-evaluation.mjs [--repeats=1|2|3]
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { loadAwsSession } from '../../scripts/load-aws-session.mjs';
import { checkTicketReport } from './ticket-regressions.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !/^--repeats=[123]$/.test(args[0]))) throw new Error('Use --repeats=1, 2 or 3. Default: 2 per case.');
const repeats = Number(args[0]?.split('=')[1] || 2);
loadAwsSession();
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const modelId = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-2-lite-v1:0';
if (region !== 'us-east-1' || modelId !== 'us.amazon.nova-2-lite-v1:0') throw new Error('This comparison targets us-east-1 and the existing Nova 2 Lite model only.');
mkdirSync('.aws-build', { recursive: true });
const bundle = '.aws-build/prompt-evaluation-core.mjs';
const built = await build({
  stdin: { contents: "export { runInvestigation } from './lib/investigation/engine.ts'; export { INVESTIGATION_PROMPT } from './lib/investigation/prompt.ts'; export { TICKET_DEMO_CASES } from './lib/ticket-demo.ts'; export { localEvidence } from './aws/investigations.ts';", resolveDir: process.cwd(), sourcefile: 'prompt-evaluation-entry.ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
  outfile: bundle, metafile: true, logLevel: 'warning',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = Object.keys(built.metafile.inputs).filter(file => file !== 'prompt-evaluation-entry.ts').sort();
const sourceFingerprint = () => sourceFiles.map(file => ({ file, sha256: sha256(readFileSync(file)) }));
const files = sourceFingerprint();
const source = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  files, sourceTreeSha256: sha256(JSON.stringify(files)), bundleSha256: sha256(readFileSync(bundle)),
  note: 'Actual locally bundled source; includes uncommitted files. No claim about the deployed Lambda build.',
};
const { runInvestigation, INVESTIGATION_PROMPT, TICKET_DEMO_CASES, localEvidence } = await import(pathToFileURL(resolve(bundle)).href);
const output = 'docs/evaluation/inventory-runs';
mkdirSync(output, { recursive: true });
const batch = randomUUID();
const client = new BedrockRuntimeClient({ region, maxAttempts: 2, requestHandler: new FetchHttpHandler({ requestTimeout: 45000 }) });
const rows = [];
let failed = false;
try {
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const item of TICKET_DEMO_CASES) {
      const startedAt = new Date().toISOString();
      const run = { id: `run_${randomUUID()}`, caseId: item.id, status: 'running', mode: 'bedrock', modelId, startedAt, events: [] };
      let result;
      let usage = { inputTokens: 0, outputTokens: 0 };
      try {
        result = await runInvestigation({
          case: item, mode: 'bedrock', modelId, region, signal: AbortSignal.timeout(120000),
          readEvidence: async section => localEvidence(item, item.evidence, section),
          assertActive: async () => {}, onEvent: async event => { run.events.push(event); },
          invokeModel: async (request, signal) => {
            const response = await client.send(new ConverseCommand(request), { abortSignal: signal });
            usage = { inputTokens: usage.inputTokens + (response.usage?.inputTokens || 0), outputTokens: usage.outputTokens + (response.usage?.outputTokens || 0) };
            return response;
          },
        });
        run.status = 'completed';
      } catch (error) {
        failed = true;
        run.status = 'failed';
        run.error = { code: error.code || error.name, message: 'Local live evaluation failed; no fallback result substituted.' };
      }
      run.finishedAt = new Date().toISOString();
      const sourceStable = JSON.stringify(files) === JSON.stringify(sourceFingerprint());
      if (!sourceStable) throw new Error('Source changed during live evaluation. Do not compare this batch as a fixed build.');
      const saved = {
        order: item.orderRef, caseId: item.id, startedAt, finishedAt: run.finishedAt, batch, repeat,
        case: { id: item.id, title: item.title, orderRef: item.orderRef, reason: item.reason, amount: item.amount, currency: item.currency, source: item.source },
        repoCommit: source.commit, execution: 'local engine, real Bedrock; no deployed API or storage',
        source, promptSha256: sha256(INVESTIGATION_PROMPT), sourceStable,
        inputProvenance: 'synthetic fixture (lib/ticket-demo.ts) normalized through aws/investigations.ts localEvidence',
        inputSha256: sha256(JSON.stringify(item)), run, usage,
        ...(result ? { draft: { caseId: item.id, content: result.content, analysis: result, method: 'bedrock', status: 'draft', revision: 1 }, evidence: item.evidence } : { evidence: item.evidence }),
      };
      const issues = result ? checkTicketReport(saved) : [{ code: 'run_failed', severity: 'failure', message: run.error.code }];
      const file = `${item.orderRef}-${run.id}.json`;
      writeFileSync(`${output}/${file}`, JSON.stringify({ ...saved, regressionSignals: issues }, null, 2) + '\n');
      rows.push({ order: item.orderRef, repeat, runId: run.id, status: run.status, assessment: result?.assessment, metrics: result?.metrics, usage, issues, file });
      writeFileSync(`${output}/summary.json`, JSON.stringify({ batch, execution: saved.execution, source, promptSha256: saved.promptSha256, modelId, region, rows, semanticReview: 'pending; regression signals are fixture-specific checks, not proof of claim support' }, null, 2) + '\n');
      console.log(`${item.orderRef} repeat ${repeat}: ${run.status}; assessment=${result?.assessment || 'none'}; signals=${issues.map(issue => issue.code).join(',') || 'none'}; ${output}/${file}`);
      // Stop on operational failure instead of repeatedly spending on a broken session/configuration.
      if (!result) throw new Error(`Evaluation stopped after ${run.id}: ${run.error.code}. Diagnostic artifact saved.`);
    }
  }
} finally { client.destroy(); }
if (failed) process.exitCode = 1;
