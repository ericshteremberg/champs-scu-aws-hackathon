import { describe, expect, it } from 'vitest';
import { buildDemoReport, finalizeReport, validateReport, type ReportInput } from '../server/report.js';
import type { CaseRecord, EvidenceEnvelope, InvestigationRun } from '../shared/types.js';

const timestamp = '2026-11-07T18:00:00Z';
const item: CaseRecord = {
  id: 'case_under_review', merchantId: 'merchant_123', merchantName: 'Example merchant', customerLabel: 'Customer reference 123',
  claim: 'The ticket did not arrive.', reason: 'Ticket not received', amount: 5000, currency: 'USD', eventName: 'Example event',
  purchasedAt: '2026-11-01T18:00:00Z', openedAt: '2026-11-06T18:00:00Z', dueAt: '2026-11-14T18:00:00Z',
  sourceMode: 'synthetic', status: 'needs_review', summary: 'A payment needs evidence review.', orderRef: 'ORDER-123', paymentRef: 'payment_123', tags: [],
};

function evidence(fields: Record<string, string | number | boolean | null> = { providerStatus: 'accepted' }): EvidenceEnvelope[] {
  return [{
    caseId: item.id, section: 'delivery', sourceMode: 'synthetic', fetchedAt: timestamp, status: 'partial',
    records: [{ id: 'current_case:email', source: 'Mail provider', sourceId: 'message_123', occurredAt: timestamp, title: 'Delivery evidence', detail: 'The provider returned the recorded status. Reading is not recorded.', fields }],
    limitations: ['Reading is not established.'],
  }];
}

function report(): ReportInput {
  return {
    summary: 'Email processing is recorded, but receipt remains unconfirmed.', assessment: 'insufficient', recommendation: 'Retrieve additional delivery evidence.',
    findings: [{ id: 'finding_1', title: 'Email processing recorded', detail: 'The provider accepted the message.', stance: 'neutral', evidenceIds: ['current_case:email'] }],
    gaps: ['Inbox delivery is unknown.'], responseDraft: 'The provider accepted the message for processing. [current_case:email]',
  };
}

describe('report evidence validation', () => {
  it('accepts a report whose findings and draft cite retrieved records', () => {
    const result = validateReport(report(), evidence());
    expect(result.responseDraft).toEqual(report().responseDraft);
    expect(result.findings).toEqual(report().findings);
    expect(result.gaps).toEqual(expect.arrayContaining(['Inbox delivery is unknown.', 'Reading is not established.']));
  });

  it('rejects a finding citation from a different case', () => {
    const value = report();
    value.findings[0].evidenceIds = ['other_case:email'];
    expect(() => validateReport(value, evidence())).toThrow(expect.objectContaining({ code: 'INVALID_CITATION' }));
  });

  it('checks the response draft independently of the finding citation list', () => {
    const value = { ...report(), responseDraft: 'The customer read the message. [not_retrieved]' };
    expect(() => validateReport(value, evidence())).toThrow(expect.objectContaining({ code: 'INVALID_CITATION' }));
  });

  it('requires a draft citation when evidence has been retrieved', () => {
    const value = { ...report(), responseDraft: 'The provider accepted the message.' };
    expect(() => validateReport(value, evidence())).toThrow(expect.objectContaining({ code: 'MISSING_CITATIONS' }));
  });

  it('rejects an uncited finding even when the draft has a valid citation', () => {
    const value = report();
    value.findings[0].evidenceIds = [];
    expect(() => validateReport(value, evidence())).toThrow(expect.objectContaining({ code: 'INVALID_REPORT' }));
  });

  it('rejects duplicate finding IDs and unexpected control fields', () => {
    const value = report();
    value.findings.push({ ...value.findings[0] });
    expect(() => validateReport(value, evidence())).toThrow(expect.objectContaining({ code: 'INVALID_REPORT' }));
    expect(() => validateReport({ ...report(), reviewedAt: timestamp }, evidence())).toThrow(expect.objectContaining({ code: 'INVALID_REPORT' }));
  });

  it('can describe missing evidence without fabricating a citation', () => {
    const value: ReportInput = { ...report(), findings: [], responseDraft: 'The delivery source is unavailable. Request the missing records.' };
    const result = validateReport(value, [{ ...evidence()[0], status: 'unavailable', records: [] }]);
    expect(result.responseDraft).toBe(value.responseDraft);
    expect(result.gaps).toContain('Delivery evidence is unavailable.');
  });

  it('does not allow an evidence-free case to be reported as supported', () => {
    const value: ReportInput = { ...report(), assessment: 'supported', findings: [], responseDraft: 'The claim is resolved.' };
    expect(() => validateReport(value, [])).toThrow(expect.objectContaining({ code: 'INVALID_ASSESSMENT' }));
  });

  it('binds the final report to its run and derives metrics from observed calls', () => {
    const run: InvestigationRun = {
      id: 'run_123', caseId: item.id, mode: 'demo', status: 'running', startedAt: new Date(Date.now() - 250).toISOString(), evidence: evidence(),
      events: [
        { id: 'event_1', runId: 'run_123', at: timestamp, type: 'tool_requested', title: 'Request', detail: 'Delivery' },
        { id: 'event_2', runId: 'run_123', at: timestamp, type: 'tool_completed', title: 'Result', detail: 'Delivery' },
      ],
    };
    const result = finalizeReport(report(), run);
    expect(result).toMatchObject({ caseId: item.id, runId: 'run_123', evidenceIds: ['current_case:email'], metrics: { toolCalls: 1, recordCount: 1 } });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(250);
    expect(result.reviewedAt).toBeUndefined();
  });

  it('indexes citations used only in the response draft as well as findings', () => {
    const sources = evidence();
    sources[0].records.push({ ...sources[0].records[0], id: 'current_case:second_attempt', sourceId: 'message_124' });
    const value = { ...report(), responseDraft: `${report().responseDraft}\nA second attempt is recorded. [current_case:second_attempt]` };
    const run: InvestigationRun = { id: 'run_123', caseId: item.id, mode: 'demo', status: 'running', startedAt: new Date().toISOString(), evidence: sources, events: [] };
    expect(finalizeReport(value, run).evidenceIds).toEqual(['current_case:email', 'current_case:second_attempt']);
  });
});

describe('sample investigator evidence distinctions', () => {
  it('does not classify email acceptance as proof of receipt', () => {
    const result = buildDemoReport(item, evidence({ providerStatus: 'accepted', delivered: null }));
    expect(result.assessment).toBe('insufficient');
    expect(result.findings[0].stance).toBe('neutral');
  });

  it('does not treat missing delivery records as delivery failure', () => {
    const result = buildDemoReport(item, [{ ...evidence()[0], status: 'unavailable', records: [], limitations: ['Delivery history unavailable.'] }]);
    expect(result.assessment).toBe('insufficient');
    expect(result.gaps).toContain('Delivery history unavailable.');
    expect(result.findings).toHaveLength(0);
  });

  it('surfaces failed delivery as evidence supporting the customer', () => {
    const result = buildDemoReport(item, evidence({ providerStatus: 'bounced', delivered: false }));
    expect(result.assessment).toBe('mixed');
    expect(result.findings[0].stance).toBe('supports_customer');
  });

  it('keeps the distinction between a provider delivery status and reading', () => {
    const result = buildDemoReport(item, evidence({ providerStatus: 'delivered', read: null }));
    expect(result.assessment).toBe('insufficient');
    expect(result.gaps).toContain('A provider delivery status does not establish that the message was read by the cardholder.');
  });

  it('uses a retrieved customer acknowledgement without requiring a particular fixture ID', () => {
    const records = evidence({ customerAcknowledgedReceipt: true, messageRole: 'customer' });
    records[0].section = 'support';
    const result = buildDemoReport({ ...item, id: 'an_unrelated_case_id' }, records);
    expect(result.assessment).toBe('supported');
    expect(result.findings[0].stance).toBe('supports_merchant');
    expect(result.findings[0].evidenceIds).toEqual(['current_case:email']);
  });
});
