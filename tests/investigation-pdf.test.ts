import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { createEvidencePdf } from '../lib/report/pdf.ts';
import { assertPacketReady, categoryDiagnostics, citationText, packetNotes, packetResponse, packetSources, packetIncludedSources, packetClaim } from '../lib/report/packet.ts';
import { evidenceSections } from '../lib/investigation/sections.ts';
import { loadVisualExhibits, hashBytes, type Exhibit } from '../lib/report/exhibits.ts';
import { responseStyleFeedback } from '../lib/investigation/report.ts';
import { runInvestigation } from '../lib/investigation/engine.ts';
import type { DisputeCase, Evidence } from '../lib/domain.ts';
import type { EvidenceEnvelope } from '../lib/investigation/types.ts';

const record: Evidence = { id: 'ev_order', caseId: 'case_test', source: 'database', title: 'Order, ticket and policy snapshot', content: 'Order recorded. Ticket invalidated. No scan records. Nonrefundable policy snapshot; acceptance is not recorded.', occurredAt: '2026-08-21T18:30:00Z', reference: 'synthetic-order' };
const fixture = (): DisputeCase => ({ id: 'case_test', title: 'Synthetic ticket dispute', customerName: 'Zoë Müller', email: 'customer@example.test', amount: 2936, currency: 'usd', status: 'needs_review', reason: 'product_unacceptable', orderRef: 'DEMO-1042', dueAt: '2026-12-13T00:00:00Z', source: 'demo', createdAt: record.occurredAt, updatedAt: record.occurredAt, evidence: [structuredClone(record)], findings: [{ kind: 'supported', title: 'Order record', detail: 'The order is recorded. [ev_order]', evidenceIds: ['ev_order'] }], draft: { revision: 1, status: 'draft', generatedAt: record.occurredAt, method: 'bedrock', content: 'The order is recorded. [ev_order]\n\nSOURCE LIMITATIONS\n- No order records are attached to this case. This does not establish that an event did not occur.\n- Policy acceptance is not recorded.' } });
const fonts = { regular: new Uint8Array(readFileSync('public/fonts/LiberationSans-Regular.ttf')), bold: new Uint8Array(readFileSync('public/fonts/LiberationSans-Bold.ttf')) };

describe('evidence packet', () => {
  it('uses readable citations, separates legacy diagnostics, and preserves material qualifications', () => {
    const item = fixture();
    expect(packetResponse(item)).toBe('The order is recorded. [E1]');
    expect(packetNotes(item)).toEqual(['Policy acceptance is not recorded.']);
    expect(citationText('An unsupported reference [ev_other]', packetSources(item))).toContain('[ev_other]');
    expect(categoryDiagnostics(item)).toEqual([]);
    expect(packetClaim({ ...item, reason: 'Stripe reason: product_unacceptable (Mastercard 4853). Review original charge only.' })).toBe('product_unacceptable (Mastercard 4853)');
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
  it('includes uncited factual records and originals, keeping explicitly labeled analyst notes internal', () => {
    const item = fixture();
    item.draft!.content = 'The confirmation was sent, but the venue differs from the reminder. [ev_order]';
    item.evidence.push({ ...record, id: 'ev_internal', source: 'manual', title: 'Internal collection diagnostics', reference: 'Analyst review - not primary proof', content: 'Connection unavailable' });
    item.evidence.push({ ...record, id: 'ev_original', title: 'Receipt', fileName: 'receipt.pdf', downloadUrl: '/api/evidence/ev_original' });
    item.evidence.push({ ...record, id: 'ev_extra', title: 'Additional source record' });
    expect(packetIncludedSources(item).map(record => record.id)).toEqual(['ev_order', 'ev_original', 'ev_extra']);
    expect(packetResponse(item)).toContain('but the venue differs from the reminder');
    expect(item.evidence).toHaveLength(4);
  });
  it('allows additional pages instead of truncating evidence or imposing a two-page limit', async () => {
    const item = fixture();
    item.draft!.content = 'Supported transaction fact with qualification. '.repeat(1000) + '[ev_order]';
    const pdf = await PDFDocument.load(await createEvidencePdf(item, fonts));
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    expect(item.draft!.content).toContain('[ev_order]');
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
  it('preserves full source text, Unicode and long references without mutating the case', async () => {
    const item = fixture();
    item.evidence[0].content += '\n' + 'Long source line with accented names Zoë Müller. '.repeat(400) + '🙂';
    item.evidence[0].reference = 'x'.repeat(300);
    const before = JSON.stringify(item);
    const bytes = await createEvidencePdf(item, fonts, new Date('2026-11-08T12:00:00Z'));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
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


describe('original visual exhibits', () => {
  const image = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64'));
  async function visualCase() {
    const item = fixture(), sha256 = await hashBytes(image);
    item.evidence[0] = { ...item.evidence[0], fileName: 'original.png', mimeType: 'image/png', downloadUrl: '/api/evidence/ev_order', fileSha256: sha256, capturedAt: record.occurredAt };
    return { item, exhibit: { evidenceId: record.id, bytes: image, mimeType: 'image/png', sha256, fetchedAt: record.occurredAt } as Exhibit };
  }
  it('embeds the actual image and original file bytes, and never substitutes descriptive text', async () => {
    const { item, exhibit } = await visualCase();
    const pdf = await PDFDocument.load(await createEvidencePdf(item, fonts, new Date(), [exhibit]));
    expect(pdf.context.enumerateIndirectObjects().some(([,object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))).toBe(true);
    expect(pdf.catalog.has(PDFName.of('Names'))).toBe(true);
    await expect(createEvidencePdf(item, fonts)).rejects.toThrow('Original exhibits are missing');
    await expect(createEvidencePdf(item, fonts, new Date(), [{ ...exhibit, evidenceId: 'unrelated' }])).rejects.toThrow('do not belong');
    await expect(createEvidencePdf(item, fonts, new Date(), [{ ...exhibit, sha256: '0'.repeat(64) }])).rejects.toThrow('changed');
  });
  it('reproduces every page of an original PDF', async () => {
    const original = await PDFDocument.create(); original.addPage([300,400]).drawText('Synthetic original page one'); original.addPage([300,400]).drawText('Synthetic original page two');
    const bytes = await original.save(), sha256 = await hashBytes(bytes), item = fixture();
    item.evidence[0] = { ...item.evidence[0], fileName: 'receipt.pdf', mimeType: 'application/pdf', downloadUrl: '/api/evidence/ev_order', fileSha256: sha256 };
    const pdf = await PDFDocument.load(await createEvidencePdf(item, fonts, new Date(), [{ evidenceId: record.id, bytes, mimeType: 'application/pdf', sha256, fetchedAt: record.occurredAt }]));
    expect(pdf.getPageCount()).toBe(3);
  });
  it('loads only authorized originals and fails on retrieval, format or fingerprint mismatch', async () => {
    const { item } = await visualCase();
    const request = async () => new Response(image, { status: 200 });
    expect(await loadVisualExhibits(item, request as typeof fetch)).toHaveLength(1);
    await expect(loadVisualExhibits(item, (async () => new Response('', {status:404})) as typeof fetch)).rejects.toThrow('could not be retrieved');
    item.evidence[0].fileSha256 = '0'.repeat(64);
    await expect(loadVisualExhibits(item, request as typeof fetch)).rejects.toThrow('fingerprint');
    item.evidence[0].downloadUrl = 'https://unrelated.example.test/file';
    await expect(loadVisualExhibits(item, request as typeof fetch)).rejects.toThrow('invalid case download link');
  });
});
