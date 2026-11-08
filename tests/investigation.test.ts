import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { runInvestigation, validateEnvelope } from '../lib/investigation/engine.ts';
import { fetchMerchantSection, normalizeMerchantSection } from '../lib/investigation/merchant.ts';
import { buildSampleReport, CitationAliases, validateReport } from '../lib/investigation/report.ts';
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
  it('allows an Opus report to complete after the old two-minute investigation deadline', async () => {
    vi.useFakeTimers();
    try {
      const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>()
        .mockResolvedValueOnce(modelResponse(['order', 'tickets', 'delivery', 'support'].map(section => ({ name: 'get_evidence', input: { section } }))))
        .mockImplementationOnce(async () => {
          await new Promise(resolve => setTimeout(resolve, 150_000));
          return modelResponse([{ name: 'finish_report', input: report() }]);
        });
      const pending = runInvestigation(input({ mode: 'bedrock', modelId: 'us.anthropic.claude-opus-5', invokeModel: invoke }));
      await vi.advanceTimersByTimeAsync(151_000);
      const result = await pending;
      expect(result.modelId).toBe('us.anthropic.claude-opus-5');
      expect(invoke.mock.calls[1][1].aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('identifies a Bedrock transport timeout without suggesting invalid credentials', async () => {
    const timeout = Object.assign(new Error('private provider details'), { name: 'TimeoutError' });
    const options = input({ mode: 'bedrock', modelId: 'us.anthropic.claude-opus-5', invokeModel: async () => { throw timeout; } });
    await expect(runInvestigation(options)).rejects.toMatchObject({ code: 'bedrock_timeout', message: expect.stringContaining('120 seconds') });
    expect(options.events.some(event => event.type === 'completed')).toBe(false);
  });

  it('loads attached policy evidence into the first model context before drafting', async () => {
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>()
      .mockResolvedValueOnce(modelResponse(['order', 'tickets', 'delivery', 'support'].map(section => ({ name: 'get_evidence', input: { section } }))))
      .mockResolvedValueOnce(modelResponse([{ name: 'finish_report', input: report() }]));
    const options = input({ mode: 'bedrock', modelId: 'test-model', requirePolicy: true, invokeModel: invoke, readEvidence: async section => section === 'policy' ? { ...envelope(section), status: 'partial', records: [{ id: 'policy_saved', source: 'policy', sourceId: 'policy_version', occurredAt: timestamp, title: 'Retained terms', detail: 'Refund requests within 14 days. Historical applicability is unverified.', fields: {} }] } : envelope(section) });
    await runInvestigation(options);
    const context = JSON.parse(invoke.mock.calls[0][0].messages![0].content![0].text!);
    expect(context.initialPolicy.records[0]).toMatchObject({ sourceId: 'policy_version', detail: expect.stringContaining('Historical applicability is unverified') });
    expect(options.events.filter(e => e.type === 'tool_completed' && e.section === 'policy')).toHaveLength(1);
  });

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
    const options = input({ readEvidence: async section => { const value = envelope(section); if (value.records[0]) value.records[0].title = 'Email record [image attached]'; return value; } });
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

  it('shows short aliases to Bedrock and persists only canonical evidence references', async () => {
    let calls = 0;
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>(async request => {
      calls++;
      if (calls === 1) {
        const initial = JSON.parse(request.messages![0].content![0].text!);
        expect(initial.initialSummary.records[0]).toMatchObject({ id: 'E1', sourceId: 'original_summary' });
        return modelResponse((['order','tickets','delivery','support'] as const).map(section => ({ name: 'get_evidence', input: { section } })));
      }
      const returned = request.messages!.at(-1)!.content!.map(block => block.toolResult?.content?.[0].json as { records: { id: string }[] });
      expect(returned.map(section => section.records[0].id)).toEqual(['E2','E3','E4','E5']);
      return modelResponse([{ name: 'finish_report', input: { ...report(), content: 'Payment is recorded. [E1] Support is attached. [E5]', summary: 'Payment and support records are attached. [E1] [E5]', findings: [{ ...report().findings[0], detail: 'The source records include payment and support. [E1] [E5]', evidenceIds: ['E1','E5'] }] } }]);
    });
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke });
    const result = await runInvestigation(options);
    expect(result.content).toContain('[record_summary]'); expect(result.content).toContain('[record_support]');
    expect(result.summary).toContain('[record_summary]');
    expect(result.findings[0].evidenceIds).toEqual(['record_summary','record_support']);
    expect(result.findings[0].detail).toContain('[record_support]');
    expect(JSON.stringify(result)).not.toMatch(/\[E\d+\]/);
    expect(options.events.flatMap(event => event.evidenceIds || [])).toContain('record_summary');
    expect(options.events.flatMap(event => event.evidenceIds || []).some(id => /^E\d+$/.test(id))).toBe(false);
  });

  it('rejects invented aliases with actionable valid-reference feedback before accepting a corrected report', async () => {
    let calls = 0;
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>(async request => {
      calls++;
      if (calls === 1) return modelResponse((['order','tickets','delivery','support'] as const).map(section => ({ name: 'get_evidence', input: { section } })));
      if (calls === 2) return modelResponse([{ name: 'finish_report', input: { ...report(), content: 'The ticket was received. [E999]', findings: [{ ...report().findings[0], evidenceIds: ['E999'] }] } }]);
      const feedback = request.messages!.at(-1)!.content![0].toolResult!;
      expect(feedback.status).toBe('error');
      expect(feedback.content![0].text).toContain('E1, E2, E3, E4, E5');
      expect(feedback.content![0].text).toContain('"field":"content","reference":"E999"');
      expect(feedback.content![0].text).toContain('"field":"findings[0].evidenceIds","reference":"E999"');
      expect(feedback.content![0].text).toContain('[E1] [E2]');
      expect(feedback.content![0].text).toContain('Do not cite sourceId');
      return modelResponse([{ name: 'finish_report', input: { ...report(), content: 'The payment record is attached. [E1]', findings: [{ ...report().findings[0], evidenceIds: ['E1'] }] } }]);
    });
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke });
    const result = await runInvestigation(options);
    expect(result.evidenceIds).toEqual(['record_summary']);
    expect(options.events.filter(event => event.type === 'blocked')).toHaveLength(1);
    expect(result.metrics.modelCalls).toBe(3);
  });

  it('offers only unread sections and forces Nova to finish once all sections have been retrieved', async () => {
    let calls = 0;
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>(async request => {
      calls++;
      if (calls === 1) {
        expect(request.toolConfig?.toolChoice).toEqual({ any: {} });
        const retrieval = request.toolConfig!.tools![0].toolSpec!;
        expect((retrieval.inputSchema!.json as { properties: { section: { enum: string[] } } }).properties.section.enum).not.toContain('summary');
        return modelResponse(EVIDENCE_SECTIONS.filter(section => section !== 'summary').map(section => ({ name: 'get_evidence', input: { section } })));
      }
      expect(request.toolConfig!.tools!.map(tool => tool.toolSpec?.name)).toEqual(['finish_report']);
      expect(request.toolConfig!.toolChoice).toEqual({ tool: { name: 'finish_report' } });
      return modelResponse([{ name: 'finish_report', input: { ...report(), content: 'The payment record is attached. [E1]', findings: [{ ...report().findings[0], evidenceIds: ['E1'] }] } }]);
    });
    const result = await runInvestigation(input({ mode: 'bedrock', modelId: 'us.amazon.nova-2-lite-v1:0', invokeModel: invoke }));
    expect(result.metrics.modelCalls).toBe(2);
    expect(result.evidenceIds).toEqual(['record_summary']);
  });

  it('returns exactly one tool result for each repeated section request without fetching it again', async () => {
    let calls = 0;
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>(async request => {
      calls++;
      if (calls === 1) return modelResponse((['order','order','tickets','delivery','support'] as const).map(section => ({ name: 'get_evidence', input: { section } })));
      const results = request.messages!.at(-1)!.content!.map(block => block.toolResult!);
      expect(results.map(result => result.toolUseId)).toEqual(['tool_0','tool_1','tool_2','tool_3','tool_4']);
      expect(results.map(result => result.status)).toEqual(['success','error','success','success','success']);
      expect(results[1].content![0].text).toContain('already retrieved');
      return modelResponse([{ name: 'finish_report', input: report() }]);
    });
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke });
    await runInvestigation(options);
    expect(vi.mocked(options.readEvidence).mock.calls.filter(([section]) => section === 'order')).toHaveLength(1);
  });

  it('reserves the last two model calls for reporting while retaining unrequested-source gaps', async () => {
    let calls = 0;
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>(async request => {
      calls++;
      if (calls === 1) return modelResponse((['order','tickets','delivery','support'] as const).map(section => ({ name: 'get_evidence', input: { section } })));
      if (calls < 11) return { $metadata: {}, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, metrics: { latencyMs: 1 }, output: { message: { role: 'assistant', content: [{ text: 'Considering the next step.' }] } }, stopReason: 'end_turn' };
      expect(request.toolConfig!.tools!.map(tool => tool.toolSpec?.name)).toEqual(['finish_report']);
      expect(request.toolConfig!.toolChoice).toEqual({ tool: { name: 'finish_report' } });
      return modelResponse([{ name: 'finish_report', input: report() }]);
    });
    const result = await runInvestigation(input({ mode: 'bedrock', modelId: 'us.amazon.nova-2-lite-v1:0', invokeModel: invoke }));
    expect(result.metrics.modelCalls).toBe(11);
    expect(result.gaps).toContain('Policy records were not requested during this investigation.');
  });

  it('identifies a missing content field for the model without exposing schema details in persisted events', async () => {
    let calls = 0;
    const invoke = vi.fn<NonNullable<InvestigationInput['invokeModel']>>(async request => {
      calls++;
      if (calls === 1) return modelResponse((['order','tickets','delivery','support'] as const).map(section => ({ name: 'get_evidence', input: { section } })));
      if (calls === 2) {
        const { content: _content, ...incomplete } = report();
        return modelResponse([{ name: 'finish_report', input: incomplete }]);
      }
      const feedback = request.messages!.at(-1)!.content![0].toolResult!.content![0].text!;
      expect(feedback).toContain('"field":"content"');
      expect(feedback).toContain('expected string, received undefined');
      expect(feedback).toContain('complete report, not just the changed fields');
      const schema = request.toolConfig!.tools!.find(tool => tool.toolSpec?.name === 'finish_report')!.toolSpec!.inputSchema!.json as { properties: { content: { minLength: number; maxLength: number }; findings: { maxItems: number } } };
      expect(schema.properties.content).toMatchObject({ minLength: 1, maxLength: 50000 });
      expect(schema.properties.findings.maxItems).toBe(30);
      return modelResponse([{ name: 'finish_report', input: report() }]);
    });
    const options = input({ mode: 'bedrock', modelId: 'test-model', invokeModel: invoke });
    const result = await runInvestigation(options);
    expect(result.metrics.modelCalls).toBe(3);
    const blocked = options.events.filter(event => event.type === 'blocked');
    expect(blocked[0].detail).toBe('The investigation did not produce the required report format.');
    expect(blocked[0].detail).not.toContain('undefined');
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
