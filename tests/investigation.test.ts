import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { runInvestigation, validateEnvelope } from '../lib/investigation/engine.ts';
import { fetchMerchantSection, normalizeMerchantSection } from '../lib/investigation/merchant.ts';
import { buildSampleReport, validateReport } from '../lib/investigation/report.ts';
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
  it('retrieves scoped records, preserves IDs, and labels sample output honestly', async () => {
    const options = input();
    const result = await runInvestigation(options);
    expect(result.content).toContain('not analyzed by a language model');
    expect(result.content).toContain('[record_summary]');
    expect(result.metrics).toMatchObject({ toolCalls: 8, modelCalls: 0, recordCount: 6 });
    expect(result.assessment).toBe('insufficient');
    expect(result.gaps).toContain('attendance history is unavailable.');
    expect(options.events.at(-1)?.type).toBe('completed');
    expect(options.assertActive).toHaveBeenCalled();
  });

  it('does not interpret brackets in quoted source text as fabricated citations', async () => {
    const options = input({ readEvidence: async section => { const value = envelope(section); if (value.records[0]) value.records[0].detail = 'The email contains [image attached] in its body.'; return value; } });
    const result = await runInvestigation(options);
    expect(result.content).toContain('\\[image attached\\]');
    expect(result.evidenceIds).not.toContain('image attached');
  });

  it('preserves zero-decimal currency units in sample drafts', () => {
    const value = buildSampleReport({ ...caseData, currency: 'jpy', amount: 5000 }, [envelope('summary')]);
    expect(value.content).toContain('¥5,000');
  });

  it('rejects another case or malformed evidence before adding it to context', async () => {
    const options = input({ readEvidence: async section => ({ ...envelope(section), caseId: 'other_case' }) });
    await expect(runInvestigation(options)).rejects.toMatchObject({ code: 'evidence_scope_mismatch' });
    expect(options.events.some(event => event.type === 'tool_completed')).toBe(false);
  });

  it('validates summary first even when the model wants another section', async () => {
    const invoke = vi.fn(async () => modelResponse([{ name: 'get_evidence', input: { section: 'delivery' } }]));
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke, readEvidence: async () => { throw new Error('Mapping changed'); } });
    await expect(runInvestigation(options)).rejects.toThrow('Mapping changed');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('executes model tool calls and blocks attempts to expand case scope', async () => {
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>()
      .mockResolvedValueOnce(modelResponse([{ name: 'get_evidence', input: { section: 'delivery', caseId: 'other_case' } }, ...(['order','tickets','delivery','support'] as const).map(section => ({ name: 'get_evidence', input: { section } }))]))
      .mockResolvedValueOnce(modelResponse([{ name: 'finish_report', input: report() }]));
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke });
    const result = await runInvestigation(options);
    expect(result.modelId).toBe('test-model');
    expect(result.metrics.modelCalls).toBe(2);
    expect(options.events.some(event => event.type === 'blocked')).toBe(true);
    expect(result.gaps).toContain('Policy records were not requested during this investigation.');
    expect(options.readEvidence).toHaveBeenCalledTimes(5);
  });

  it('rejects invented citations, then accepts a corrected report', async () => {
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>()
      .mockResolvedValueOnce(modelResponse((['order','tickets','delivery','support'] as const).map(section => ({ name: 'get_evidence', input: { section } }))))
      .mockResolvedValueOnce(modelResponse([{ name: 'finish_report', input: { ...report(), content: 'The ticket was received. [invented_record]' } }]))
      .mockResolvedValueOnce(modelResponse([{ name: 'finish_report', input: report() }]));
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke });
    const result = await runInvestigation(options);
    expect(result.evidenceIds).toEqual(['record_summary']);
    expect(options.events.filter(event => event.type === 'blocked')).toHaveLength(1);
  });

  it('never silently substitutes sample results when AWS fails', async () => {
    const invoke = vi.fn(async () => { throw Object.assign(new Error('Sensitive upstream detail'), {name:'AccessDeniedException'}); });
    await expect(runInvestigation(input({ mode:'bedrock',modelId:'test-model',invokeModel:invoke }))).rejects.toMatchObject({code:'bedrock_failed'});
  });

  it('blocks further requests after revocation during source retrieval', async () => {
    const controller = new AbortController();
    const read = vi.fn(async (section: EvidenceSection) => { controller.abort(); return envelope(section); });
    const options = input({ signal:controller.signal, readEvidence:read });
    await expect(runInvestigation(options)).rejects.toMatchObject({code:'stopped'});
    expect(read).toHaveBeenCalledTimes(1);
    expect(options.events.some(event => event.type === 'tool_completed')).toBe(false);
  });

  it('awaits persisted event callbacks before proceeding', async () => {
    const events: string[] = [];
    await runInvestigation(input({ onEvent: async event => { await Promise.resolve(); events.push(event.type); }, readEvidence: async section => { expect(events.at(-1)).toBe('tool_requested'); return envelope(section); } }));
    expect(events.at(-1)).toBe('completed');
  });

  it('bounds even repeated cached or invalid model tool calls', async () => {
    const invoke = vi.fn(async () => modelResponse(Array.from({length:17}, () => ({name:'get_evidence',input:{section:'summary'}}))));
    await expect(runInvestigation(input({mode:'bedrock',modelId:'test-model',invokeModel:invoke}))).rejects.toMatchObject({code:'tool_limit'});
  });
});

describe('evidence and report validation', () => {
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
