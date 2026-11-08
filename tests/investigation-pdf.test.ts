import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createEvidencePdf } from '../lib/report/pdf.ts';
import { assertPacketReady, categoryDiagnostics, citationText, packetNotes, packetResponse, packetSources } from '../lib/report/packet.ts';
import { evidenceSections } from '../lib/investigation/sections.ts';
import { responseStyleFeedback } from '../lib/investigation/report.ts';
import { runInvestigation } from '../lib/investigation/engine.ts';
import type { DisputeCase, Evidence } from '../lib/domain.ts';
import type { EvidenceEnvelope } from '../lib/investigation/types.ts';

const record: Evidence = { id: 'ev_order', caseId: 'case_test', source: 'database', title: 'Order, ticket and policy snapshot', content: 'Order recorded. Ticket invalidated. No scan records. Nonrefundable policy snapshot; acceptance is not recorded.', occurredAt: '2026-08-21T18:30:00Z', reference: 'synthetic-order' };
const fixture = (): DisputeCase => ({ id: 'case_test', title: 'Synthetic ticket dispute', customerName: 'Zoë Müller', email: 'customer@example.test', amount: 2936, currency: 'usd', status: 'needs_review', reason: 'product_unacceptable', orderRef: 'DEMO-1042', dueAt: '2026-12-13T00:00:00Z', source: 'demo', createdAt: record.occurredAt, updatedAt: record.occurredAt, evidence: [structuredClone(record)], findings: [{ kind: 'supported', title: 'Order record', detail: 'The order is recorded. [ev_order]', evidenceIds: ['ev_order'] }], draft: { revision: 1, status: 'draft', generatedAt: record.occurredAt, method: 'bedrock', content: 'The order is recorded. [ev_order]\n\nSOURCE LIMITATIONS\n- No order records are attached to this case. This does not establish that an event did not occur.\n- Policy acceptance is not recorded.' } });
const fonts = { regular: new Uint8Array(readFileSync('public/fonts/Ubuntu-Regular.ttf')), bold: new Uint8Array(readFileSync('public/fonts/Ubuntu-Bold.ttf')) };

describe('evidence packet', () => {
  it('uses readable citations, separates legacy diagnostics, and preserves material qualifications', () => {
    const item = fixture();
    expect(packetResponse(item)).toBe('The order is recorded. [E1]');
    expect(packetNotes(item)).toEqual(['Policy acceptance is not recorded.']);
    expect(citationText('An unsupported reference [ev_other]', packetSources(item))).toContain('[ev_other]');
    expect(categoryDiagnostics(item)).toEqual([]);
    expect(item.draft!.content).toContain('No order records');
    item.draft!.analysis = { gaps: ['No attached records are classified under order. Related facts may appear elsewhere.', 'No records were returned from the order classification. Review related evidence.', 'A delivery receipt is missing.'] } as NonNullable<NonNullable<DisputeCase['draft']>['analysis']>;
    expect(categoryDiagnostics(item)).toHaveLength(2);
    expect(packetNotes(item)).toContain('A delivery receipt is missing.');
    item.draft!.content += '\n\nAn organizer edit after the legacy notes.';
    expect(packetResponse(item)).toContain('An organizer edit after the legacy notes.');
  });
  it('requests a factual response without deleting adverse evidence or internal review notes', () => {
    expect(responseStyleFeedback('The merchant must prove receipt or risk losing the dispute.')).toContain('Do not strengthen');
    expect(responseStyleFeedback('**Gaps and Recommendations**\nNo scan records.')).toBeTruthy();
    expect(responseStyleFeedback('The confirmation was sent, but the source does not establish delivery. The reminder and confirmation list different venues. [E1] [E2]')).toBeUndefined();
  });
  it('allows a review draft and rejects stale, running and missing-source exports', () => {
    const item = fixture();
    expect(() => assertPacketReady(item)).not.toThrow();
    item.draft!.sourceStale = true;
    expect(() => assertPacketReady(item)).toThrow('Evidence changed');
    item.draft!.sourceStale = false; item.evidence = [];
    expect(() => assertPacketReady(item)).toThrow('cited source');
    item.evidence = [record];
    item.investigation = { id: 'run_test', caseId: item.id, status: 'running', mode: 'bedrock', startedAt: record.occurredAt, events: [] };
    expect(() => assertPacketReady(item)).toThrow('finish');
  });
  it('paginates long source text, Unicode and unbroken references without mutating the case', async () => {
    const item = fixture();
    item.evidence[0].content += '\n' + 'Long source line with accented names Zoë Müller. '.repeat(400) + '🙂';
    item.evidence[0].reference = 'x'.repeat(300);
    const before = JSON.stringify(item);
    const bytes = await createEvidencePdf(item, fonts, new Date('2026-11-08T12:00:00Z'));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(5);
    expect(pdf.getTitle()).toBe('Evidence packet | DEMO-1042');
    expect(pdf.getPages().every(page => page.getWidth() === 612 && page.getHeight() === 792)).toBe(true);
    expect(JSON.stringify(item)).toBe(before);
  });
});

describe('combined attached evidence routing', () => {
  it('routes one combined record into relevant topics without claiming attendance or consent', () => {
    expect(evidenceSections(record)).toEqual(expect.arrayContaining(['order', 'tickets', 'policy', 'attendance']));
    expect(evidenceSections({ ...record, provenance: { section: 'delivery', sourceMode: 'live', fields: {}, limitations: [] } })).toEqual(['delivery']);
  });
  const envelope = (section: EvidenceEnvelope['section'], changed = false): EvidenceEnvelope => ({ caseId: 'case_test', section, sourceMode: 'attached', fetchedAt: record.occurredAt, status: 'available', limitations: [], records: [{ id: record.id, source: record.source, sourceId: record.reference, occurredAt: record.occurredAt, title: record.title, detail: changed ? 'Different content' : record.content, fields: {} }] });
  it('counts one identical attached document once across multiple topics', async () => {
    const item = fixture();
    const result = await runInvestigation({ case: item, mode: 'sample', region: 'us-east-1', signal: new AbortController().signal, assertActive: async () => {}, onEvent: async () => {}, readEvidence: async section => envelope(section) });
    expect(result.metrics.recordCount).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.evidenceIds).toEqual([record.id]);
  });
  it('rejects reuse of an ID for different content', async () => {
    await expect(runInvestigation({ case: fixture(), mode: 'sample', region: 'us-east-1', signal: new AbortController().signal, assertActive: async () => {}, onEvent: async () => {}, readEvidence: async section => envelope(section, section === 'order') })).rejects.toMatchObject({ code: 'duplicate_evidence' });
  });
});
