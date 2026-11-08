import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type Message, type Tool } from '@aws-sdk/client-bedrock-runtime';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { z } from 'zod';
import { INVESTIGATION_PROMPT } from './prompt.ts';
import { buildFactInventory, defaultPresentation, renderFactReport, SECTION_NAMES } from './facts.ts';
import { EVIDENCE_SECTIONS, InvestigationError, type EvidenceEnvelope, type EvidenceSection, type InvestigationEvent, type InvestigationInput, type InvestigationResult } from './types.ts';

const MAX_MODEL_CALLS = 3;
const TIMEOUT_MS = 120000;
const MAX_CONTEXT_BYTES = 1024 * 1024;
const scalar = z.union([z.string().max(6000), z.number().finite(), z.boolean(), z.null()]);
const envelopeSchema = z.object({
  caseId: z.string().min(1).max(200), section: z.enum(EVIDENCE_SECTIONS), sourceMode: z.enum(['live', 'attached', 'anonymized_snapshot', 'synthetic']),
  fetchedAt: z.string().datetime({ offset: true }), status: z.enum(['available', 'partial', 'unavailable']),
  records: z.array(z.object({ id: z.string().min(1).max(240).regex(/^[^\[\]\r\n]+$/), source: z.string().min(1).max(160), sourceId: z.string().min(1).max(240), occurredAt: z.string().datetime({ offset: true }), title: z.string().min(1).max(240), detail: z.string().max(24000), fields: z.record(z.string().max(100), scalar).refine(fields => Object.keys(fields).length <= 60) })).max(100),
  limitations: z.array(z.string().max(3000)).max(30),
});

export function validateEnvelope(input: unknown, caseId: string, section: EvidenceSection): EvidenceEnvelope {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) throw new InvestigationError('invalid_evidence', 'A source returned evidence that does not match the required contract.');
  const value = parsed.data;
  if (value.caseId !== caseId || value.section !== section) throw new InvestigationError('evidence_scope_mismatch', 'The source returned records for another case or section.');
  if (new Set(value.records.map(record => record.id)).size !== value.records.length || (value.status === 'unavailable' && value.records.length)) throw new InvestigationError('invalid_evidence', 'The source returned duplicate or contradictory evidence records.');
  return value;
}

const finishTool: Tool = { toolSpec: {
  name: 'finish_report', description: 'Arrange every eligible fact exactly once under its original section. Return IDs only. Code owns factual text, citations, assessment and challenge policy. Never return prose or additional fields.',
  inputSchema: { json: { type: 'object', properties: { sections: { type: 'array', maxItems: 8, items: {
    type: 'object', properties: { section: { type: 'string', enum: [...EVIDENCE_SECTIONS] }, factIds: { type: 'array', items: { type: 'string', pattern: '^F[1-9][0-9]*$' }, minItems: 1, maxItems: 180 } },
    required: ['section', 'factIds'], additionalProperties: false,
  } } }, required: ['sections'], additionalProperties: false } },
} };

export async function runInvestigation(input: InvestigationInput): Promise<InvestigationResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const stop = () => controller.abort();
  input.signal.addEventListener('abort', stop, { once: true });
  if (input.signal.aborted) controller.abort();
  const timeout = setTimeout(stop, TIMEOUT_MS);
  const signal = controller.signal;
  const evidence: EvidenceEnvelope[] = [];
  let modelCalls = 0; let contextBytes = 0;
  let client: BedrockRuntimeClient | undefined;
  const check = async () => {
    if (signal.aborted) throw new InvestigationError(input.signal.aborted ? 'stopped' : 'time_limit', input.signal.aborted ? 'The investigation was stopped.' : 'The investigation reached its two-minute limit.');
    await input.assertActive();
    if (signal.aborted) throw new InvestigationError('stopped', 'The investigation is no longer active.');
  };
  const emit = async (event: Omit<InvestigationEvent, 'id' | 'at'>) => {
    await check();
    await input.onEvent({ ...event, id: crypto.randomUUID(), at: new Date().toISOString() });
    await check();
  };
  const metrics = () => ({ durationMs: Date.now() - startedAt, toolCalls: evidence.length, recordCount: evidence.reduce((sum, section) => sum + section.records.length, 0), modelCalls });
  try {
    await check();
    if (input.mode === 'bedrock' && (!input.modelId || (!input.invokeModel && (!input.credentials?.accessKeyId || !input.credentials.secretAccessKey)))) throw new InvestigationError('aws_configuration', 'Configure the AWS model, region and server-side credentials before starting an AWS investigation.');
    await emit({ type: 'started', title: 'Investigation started', detail: input.mode === 'sample' ? 'Building a deterministic fact inventory from sample records.' : 'Code verifies the fact inventory; Amazon Bedrock arranges eligible facts for presentation.' });
    // Code retrieves the complete allowed case scope, summary first. The model cannot hide a section.
    for (const section of EVIDENCE_SECTIONS) {
      await emit({ type: 'tool_requested', title: `Checking ${section}`, detail: `Reading ${section} records for this case.`, section });
      const began = Date.now();
      const result = validateEnvelope(await input.readEvidence(section, signal), input.case.id, section);
      await check();
      contextBytes += new TextEncoder().encode(JSON.stringify(result)).byteLength;
      if (contextBytes > MAX_CONTEXT_BYTES) throw new InvestigationError('context_limit', 'The case exceeds the 1 MB investigation evidence limit. Narrow the selected records.');
      evidence.push(result);
      await emit({ type: 'tool_completed', title: result.status === 'unavailable' ? `${section} evidence unavailable` : `${result.records.length} ${section} records retrieved`, detail: result.limitations[0] || 'Source records are available for review.', section, evidenceIds: result.records.map(record => record.id), latencyMs: Date.now() - began });
    }
    const inventory = buildFactInventory(input.case, evidence);
    const finish = async (plan: unknown) => {
      await check();
      const result = renderFactReport(input.case, inventory, plan, metrics(), input.mode === 'bedrock' ? input.modelId : undefined);
      await emit({ type: 'completed', title: 'Investigation complete', detail: 'The code-controlled response and internal fact inventory are ready for review. Nothing was submitted.' });
      return result;
    };
    if (input.mode === 'sample') return await finish(defaultPresentation(inventory));
    if (!input.invokeModel) client = new BedrockRuntimeClient({ region: input.region, credentials: input.credentials, maxAttempts: 2, requestHandler: new FetchHttpHandler({ requestTimeout: 45000 }) });
    const invoke = input.invokeModel || ((request: ConverseCommandInput, activeSignal: AbortSignal) => client!.send(new ConverseCommand(request), { abortSignal: activeSignal }));
    const messages: Message[] = [{ role: 'user', content: [{ text: JSON.stringify({ task: 'Arrange these code-selected facts. Return finish_report with section/factIds only. Include all eligible IDs; no other claims or text.', sectionNames: SECTION_NAMES, facts: inventory.facts.filter(fact => inventory.packetFactIds.includes(fact.id)).map(fact => ({ id: fact.id, section: fact.section, text: fact.text })) }) }] }];
    while (modelCalls < MAX_MODEL_CALLS) {
      await emit({ type: 'model_requested', title: 'Arranging verified facts', detail: 'Amazon Bedrock can arrange fact IDs but cannot supply factual prose or citations.' });
      modelCalls++;
      let response;
      try {
        response = await invoke({ modelId: input.modelId, messages, system: [{ text: INVESTIGATION_PROMPT }], inferenceConfig: { maxTokens: 2000, temperature: 0.1 }, toolConfig: { tools: [finishTool], ...(input.modelId?.includes('amazon.nova') ? { toolChoice: { tool: { name: 'finish_report' } } } : {}) } }, signal);
      } catch (error) {
        await check();
        const known = error instanceof Error && ['AccessDeniedException', 'ExpiredTokenException', 'ValidationException', 'ThrottlingException'].includes(error.name) ? ` (${error.name})` : '';
        throw new InvestigationError('bedrock_failed', `Amazon Bedrock could not arrange the report${known}. No sample result was substituted.`);
      }
      await check();
      await emit({ type: 'model_completed', title: 'Model response received', detail: 'Checking the fact-ID layout against the complete eligible inventory.' });
      const message = response.output?.message;
      if (!message) throw new InvestigationError('invalid_model_response', 'Amazon Bedrock returned no usable presentation plan.');
      messages.push(message);
      const requests = message.content?.flatMap(block => block.toolUse ? [block.toolUse] : []) || [];
      const request = requests[0];
      if (requests.length === 1 && request.name === 'finish_report') {
        try { return await finish(request.input); }
        catch (error) {
          if (!(error instanceof InvestigationError) || error.code !== 'invalid_presentation') throw error;
          await emit({ type: 'blocked', title: 'Presentation rejected', detail: error.message });
          messages.push({ role: 'user', content: [{ toolResult: { toolUseId: request.toolUseId, status: 'error', content: [{ text: error.message }] } }] });
          continue;
        }
      }
      if (requests.length) throw new InvestigationError('tool_scope_denied', 'Only one finish_report presentation plan is permitted.');
      messages.push({ role: 'user', content: [{ text: 'Call finish_report with sections and eligible factIds only. Do not return prose.' }] });
    }
    throw new InvestigationError('model_limit', 'The model failed to produce a valid presentation plan after three attempts.');
  } finally { clearTimeout(timeout); input.signal.removeEventListener('abort', stop); client?.destroy(); }
}
