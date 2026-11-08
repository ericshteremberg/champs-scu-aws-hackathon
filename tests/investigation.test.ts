import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { runInvestigation, validateEnvelope } from '../lib/investigation/engine.ts';
import { fetchMerchantSection, normalizeMerchantSection } from '../lib/investigation/merchant.ts';
import { CitationAliases, validateReport } from '../lib/investigation/report.ts';
import { EVIDENCE_SECTIONS, type EvidenceEnvelope, type EvidenceSection, type InvestigationEvent, type InvestigationInput } from '../lib/investigation/types.ts';

const timestamp = '2026-11-07T18:00:00.000Z';
const caseData: InvestigationInput['case'] = { id: 'case_approved', title: 'Ticket not received', reason: 'The ticket did not arrive.', orderRef: 'ORDER-1', amount: 5000, currency: 'usd', source: 'demo' };

function envelope(section: EvidenceSection): EvidenceEnvelope {
  const unavailable = ['attendance', 'policy'].includes(section);
  return { caseId: caseData.id, section, sourceMode: 'synthetic', fetchedAt: timestamp, status: unavailable ? 'unavailable' : 'available', records: unavailable ? [] : [{ id: `record_${section}`, source: section, sourceId: `original_${section}`, occurredAt: timestamp, title: `Source ${section}`, detail: `The original ${section} record is attached.`, fields: section === 'summary' ? { orderRef: 'ORDER-1', paymentRef: 'payment_1' } : {} }], limitations: unavailable ? [`${section} history is unavailable.`] : [] };
}

function input(overrides: Partial<InvestigationInput> = {}): InvestigationInput & { events: InvestigationEvent[] } {
  const events: InvestigationEvent[] = [];
  return { case: caseData, mode: 'sample', region: 'us-east-1', signal: new AbortController().signal, readEvidence: vi.fn(async section => envelope(section)), assertActive: vi.fn(async () => {}), onEvent: vi.fn(async event => { events.push(event); }), events, ...overrides };
}

function modelResponse(requests: Array<{name:string; input:unknown}>): ConverseCommandOutput {
  return { $metadata: {}, stopReason: 'tool_use', usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 }, metrics: { latencyMs: 10 }, output: { message: { role: 'assistant', content: requests.map((request,index) => ({ toolUse: { name: request.name, input: JSON.parse(JSON.stringify(request.input)), toolUseId: `tool_${index}` } })) } } };
}

function report() {
  return { content: 'The payment record is attached. [record_summary]', summary: 'Review the attached records.', assessment: 'insufficient' as const, recommendation: 'Obtain missing delivery evidence.', findings: [{ kind: 'supported' as const, title: 'Payment record', detail: 'The payment source is attached.', evidenceIds: ['record_summary'] }], gaps: [] };
}

function wire(section: EvidenceSection = 'summary') {
  const source = envelope(section);
  return { case_id: caseData.id, section, source_mode: 'live', fetched_at: timestamp, status: source.status, records: source.records.map(record => ({ evidence_id: record.id, source: record.source, source_id: record.sourceId, occurred_at: record.occurredAt, data: { title: record.title, detail: record.detail, fields: record.fields } })), limitations: source.limitations,
    ...(section === 'summary' ? { mapping_verified: true, case: { id: caseData.id, merchantId: 'merchant_1', merchantName: 'ATMSPHR', customerLabel: 'Customer 1', claim: caseData.reason, reason: caseData.reason, amount: 5000, currency: 'USD', eventName: 'Example event', purchasedAt: timestamp, openedAt: timestamp, dueAt: timestamp, sourceMode: 'live', summary: 'A ticket dispute.', orderRef: 'ORDER-1', paymentRef: 'payment_1', tags: [] } } : {}),
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('portable investigation engine', () => {
  it('retrieves all eight sections in code, summary first, and labels sample output honestly', async () => {
    const options = input(); const result = await runInvestigation(options);
    expect(result.content).toContain('not analyzed by a language model');
    expect(result.factInventory?.facts[0].evidenceIds).toEqual(['record_summary']);
    expect(result.metrics).toMatchObject({ toolCalls: 8, modelCalls: 0, recordCount: 6 });
    expect(result.assessment).toBe('insufficient');
    expect(result.factInventory?.coverage.find(section => section.section === 'attendance')?.sourceLimitations).toContain('attendance history is unavailable.');
    expect(vi.mocked(options.readEvidence).mock.calls.map(([section]) => section)).toEqual(EVIDENCE_SECTIONS);
    expect(options.events.at(-1)?.type).toBe('completed');
  });
  it('keeps quoted free text in the internal inventory rather than promoting it to an outgoing claim', async () => {
    const result = await runInvestigation(input({ readEvidence: async section => { const value = envelope(section); if (value.records[0]) value.records[0].detail = 'The email contains [image attached] in its body.'; return value; } }));
    expect(result.factInventory?.facts[0].text).toContain('\\[image attached\\]');
    expect(result.content).not.toContain('image attached');
    expect(result.evidenceIds).not.toContain('image attached');
  });
  it('preserves zero-decimal currency units in code-generated intake values', async () => {
    const result = await runInvestigation(input({ case: { ...caseData, currency: 'jpy', amount: 5000 } }));
    expect(result.content).toContain('¥5,000');
  });
  it('rejects another case before retaining its records or calling the model', async () => {
    const invoke = vi.fn(); const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke, readEvidence: async section => ({ ...envelope(section), caseId: 'other_case' }) });
    await expect(runInvestigation(options)).rejects.toMatchObject({ code: 'evidence_scope_mismatch' });
    expect(invoke).not.toHaveBeenCalled();
    expect(options.events.some(event => event.type === 'tool_completed')).toBe(false);
  });
  it('fails summary verification before reading further sections', async () => {
    const invoke = vi.fn(); const read = vi.fn(async () => { throw new Error('Mapping changed'); });
    await expect(runInvestigation(input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke, readEvidence: read }))).rejects.toThrow('Mapping changed');
    expect(read).toHaveBeenCalledTimes(1); expect(invoke).not.toHaveBeenCalled();
  });
  it('sends only code-selected facts and an ID-only presentation tool to the model', async () => {
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>(async request => {
      expect(request.system?.[0].text).toContain('Do not return factual prose');
      expect(request.toolConfig?.tools?.map(tool => tool.toolSpec?.name)).toEqual(['finish_report']);
      const supplied = JSON.parse(request.messages![0].content![0].text!);
      expect(supplied.facts).toEqual([]); // Generic free text is not approved affirmative evidence.
      return modelResponse([{ name: 'finish_report', input: { sections: [] } }]);
    });
    const result = await runInvestigation(input({ mode: 'bedrock', modelId: 'us.amazon.nova-2-lite-v1:0', invokeModel: invoke }));
    expect(result.claimControl).toBe('code_generated'); expect(result.modelId).toBe('us.amazon.nova-2-lite-v1:0');
    expect(result.content).toContain('NO VERIFIED AFFIRMATIVE SUPPORT SELECTED');
    expect(result.metrics.modelCalls).toBe(1);
  });
  it('rejects model-authored claims and accepts a corrected presentation without publishing the claims', async () => {
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>()
      .mockResolvedValueOnce(modelResponse([{ name: 'finish_report', input: { sections: [], content: 'Customer received the tickets. [invented]' } }]))
      .mockResolvedValueOnce(modelResponse([{ name: 'finish_report', input: { sections: [] } }]));
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke });
    const result = await runInvestigation(options);
    expect(result.content).not.toContain('Customer received the tickets');
    expect(options.events.filter(event => event.type === 'blocked')).toHaveLength(1);
    expect(result.metrics.modelCalls).toBe(2);
  });
  it('rejects unknown IDs and bounds correction attempts at three calls', async () => {
    const invoke = vi.fn(async () => modelResponse([{ name: 'finish_report', input: { sections: [{ section: 'summary', factIds: ['F999'] }] } }]));
    await expect(runInvestigation(input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke }))).rejects.toMatchObject({ code: 'model_limit' });
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  it('does not expose retrieval or action tools to the model', async () => {
    const invoke = vi.fn(async () => modelResponse([{ name: 'get_evidence', input: { section: 'summary', caseId: 'other' } }]));
    await expect(runInvestigation(input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke }))).rejects.toMatchObject({ code: 'tool_scope_denied' });
  });
  it('does not publish plain assistant prose as a report', async () => {
    const invoke = vi.fn(async () => ({ $metadata: {}, stopReason: 'end_turn' as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 }, output: { message: { role: 'assistant' as const, content: [{ text: 'The merchant should win.' }] } } }));
    await expect(runInvestigation(input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke }))).rejects.toMatchObject({ code: 'model_limit' });
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  it('never silently substitutes sample results when AWS fails', async () => {
    const invoke = vi.fn(async () => { throw Object.assign(new Error('Sensitive upstream detail'), { name: 'AccessDeniedException' }); });
    await expect(runInvestigation(input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke }))).rejects.toMatchObject({ code: 'bedrock_failed' });
  });
  it('blocks further work after cancellation during source retrieval', async () => {
    const controller = new AbortController(); const read = vi.fn(async (section: EvidenceSection) => { controller.abort(); return envelope(section); });
    const options = input({ signal: controller.signal, readEvidence: read });
    await expect(runInvestigation(options)).rejects.toMatchObject({ code: 'stopped' });
    expect(read).toHaveBeenCalledTimes(1); expect(options.events.some(event => event.type === 'tool_completed')).toBe(false);
  });
  it('blocks publication after cancellation during the model call', async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => { controller.abort(); return modelResponse([{ name: 'finish_report', input: { sections: [] } }]); });
    const options = input({ mode: 'bedrock', modelId: 'test-model', signal: controller.signal, invokeModel: invoke });
    await expect(runInvestigation(options)).rejects.toMatchObject({ code: 'stopped' });
    expect(options.events.some(event => event.type === 'completed')).toBe(false);
  });
  it('awaits persisted event callbacks before proceeding', async () => {
    const events: string[] = [];
    await runInvestigation(input({ onEvent: async event => { await Promise.resolve(); events.push(event.type); }, readEvidence: async section => { expect(events.at(-1)).toBe('tool_requested'); return envelope(section); } }));
    expect(events.at(-1)).toBe('completed');
  });
  it('rejects cross-section source ID reuse', async () => {
    await expect(runInvestigation(input({ readEvidence: async section => { const value = envelope(section); for (const record of value.records) record.id = 'duplicate'; return value; } }))).rejects.toMatchObject({ code: 'duplicate_evidence' });
  });
});

describe('evidence and report validation', () => {
  it('keeps aliases stable within a run without mutating source records', () => {
    const aliases = new CitationAliases(); const original = envelope('summary');
    expect(aliases.modelView(original).records[0].id).toBe('E1');
    expect(aliases.modelView(envelope('order')).records[0].id).toBe('E2');
    expect(aliases.modelView(original).records[0].id).toBe('E1');
    expect(original.records[0].id).toBe('record_summary');
    const separate = new CitationAliases();
    expect(separate.modelView(envelope('support')).records[0].id).toBe('E1');
  });

  it('does not allow unknown aliases, another case IDs, source IDs, or grouped brackets through citation validation', () => {
    const aliases = new CitationAliases(); aliases.modelView(envelope('summary'));
    for (const invalid of ['E999', 'other_case_evidence', 'original_summary', 'E1, E2']) {
      const resolved = aliases.resolveReport({ ...report(), content: `A claim. [${invalid}]`, findings: [{ ...report().findings[0], evidenceIds: ['E1'] }] });
      expect(() => validateReport(resolved, [envelope('summary')])).toThrow('not retrieved');
    }
    expect(() => aliases.resolveReport({ ...report(), summary: 'An invented reference. [E999]' })).toThrow('not retrieved');
  });
  it('rejects duplicate records and unavailable sections carrying data', () => {
    const value = envelope('summary'); value.records.push(value.records[0]);
    expect(() => validateEnvelope(value,caseData.id,'summary')).toThrow();
    expect(() => validateEnvelope({...envelope('summary'),status:'unavailable'},caseData.id,'summary')).toThrow();
  });
  it('preserves source limitations even when the model omits them', () => {
    const result = validateReport(report(), [envelope('summary'),envelope('attendance')]);
    expect(result.gaps).toContain('attendance history is unavailable.');
  });
  it('rejects unsupported findings with no citations', () => {
    expect(() => validateReport({...report(),findings:[{...report().findings[0],evidenceIds:[]}]},[envelope('summary')])).toThrow();
  });
  it('does not permit a confident assessment without source records', () => {
    expect(() => validateReport({...report(),content:'There is no source evidence.',findings:[],assessment:'supported'},[])).toThrow();
  });
});

describe('merchant evidence contract', () => {
  it('normalizes a verified summary while preserving provenance', () => {
    const result = normalizeMerchantSection(wire(),caseData.id,'summary');
    expect(result.mappingVerified).toBe(true);
    expect(result.case?.merchantId).toBe('merchant_1');
    expect(result.evidence.records[0].id).toBe('record_summary');
  });
  it('rejects cross-case responses and unverified payment mappings', () => {
    expect(() => normalizeMerchantSection({...wire(),case_id:'other'},caseData.id,'summary')).toThrow();
    expect(() => normalizeMerchantSection({...wire(),mapping_verified:false},caseData.id,'summary')).toThrow();
    const value = wire(); value.case!.paymentRef = 'other_payment';
    expect(() => normalizeMerchantSection(value,caseData.id,'summary')).toThrow();
  });
  it('keeps credentials on the fixed server-selected origin and disallows redirects', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(wire()),{headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    await fetchMerchantSection({baseUrl:'https://merchant.example',token:'test-token'},caseData.id,'summary',new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith(`https://merchant.example/v1/cases/${caseData.id}/evidence?section=summary`,expect.objectContaining({redirect:'error',headers:expect.objectContaining({Authorization:'Bearer test-token'})}));
  });
  it('fails closed when the merchant revokes a case grant', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response('private detail',{status:403})));
    await expect(fetchMerchantSection({baseUrl:'https://merchant.example',token:'test-token'},caseData.id,'summary',new AbortController().signal)).rejects.toMatchObject({code:'merchant_access_denied'});
  });
  it('rejects oversized source responses without parsing or retaining them', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})));
    await expect(fetchMerchantSection({baseUrl:'https://merchant.example',token:'test-token'},caseData.id,'summary',new AbortController().signal)).rejects.toMatchObject({code:'evidence_too_large'});
  });
});
