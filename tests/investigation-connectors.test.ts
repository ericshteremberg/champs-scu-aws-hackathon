import { describe, expect, it } from 'vitest';
import { normalizeMerchantSection } from '../lib/investigation/merchant.ts';
import { EVIDENCE_SECTIONS } from '../lib/investigation/types.ts';
import { runInvestigation } from '../lib/investigation/engine.ts';
import { assertConnectorGrant, buildReadPlan, CONNECTOR_TEMPLATES, connectorManifestSchema, envelopeToWire, getConnectorTemplate, normalizeConnectorSection, previewConnector, type ConnectorGrant } from '../lib/evidence-connectors/index.ts';

const now = new Date('2026-11-07T18:00:00Z');
function context() {
  const template = getConnectorTemplate('atmsphr-tickets');
  const preview = previewConnector(template.manifest, template.id);
  const grant: ConnectorGrant = { caseId: preview.case.id, merchantId: preview.case.merchantId, orderId: 'demo_order_1042', orderRef: preview.case.orderRef, paymentRef: preview.case.paymentRef, expiresAt: '2099-01-01T00:00:00Z', revoked: false, case: preview.case };
  const root = { __scope_orderId: grant.orderId, __scope_merchantId: grant.merchantId, __scope_orderRef: grant.orderRef, __scope_paymentRef: grant.paymentRef, id: grant.orderId, merchantId: grant.merchantId, orderRef: grant.orderRef, paymentRef: grant.paymentRef, amount: 5000, currency: 'USD', purchasedAt: '2026-11-04T18:00:00Z' };
  const child = { __scope_orderId: grant.orderId, __scope_merchantId: grant.merchantId, __scope_orderRef: grant.orderRef, __scope_paymentRef: grant.paymentRef, id: 'ticket_1', occurredAt: '2026-11-04T18:00:01Z', f_0: 'issued', f_1: 'General admission', contact_email: 'DO_NOT_RETURN', qr_secret: 'DO_NOT_RETURN' };
  return { manifest: template.manifest, grant, root, child };
}

describe('reusable evidence connector examples', () => {
  it.each(CONNECTOR_TEMPLATES)('runs $id through the fact inventory without inferring proof from unmapped fields', async template => {
    const preview = previewConnector(template.manifest, template.id);
    const result = await runInvestigation({
      case: { id: preview.case.id, title: preview.case.reason, reason: preview.case.claim, orderRef: preview.case.orderRef, amount: preview.case.amount, currency: preview.case.currency, source: 'demo' },
      mode: 'sample', region: 'us-east-1', signal: new AbortController().signal,
      readEvidence: async section => preview.sections.find(value => value.section === section)!,
      assertActive: async () => {}, onEvent: async () => {},
    });
    expect(result.claimControl).toBe('code_generated');
    expect(result.factInventory?.coverage).toHaveLength(8);
    expect(result.factInventory?.synthetic).toBe(true);
    expect(result.factInventory?.packetFactIds).toEqual([]);
    expect(result.content).toContain('NO VERIFIED AFFIRMATIVE SUPPORT SELECTED');
  });
  it.each(CONNECTOR_TEMPLATES)('normalizes $id through the same engine with explicit synthetic provenance', template => {
    const result = previewConnector(template.manifest, template.id);
    expect(result.sourceMode).toBe('synthetic');
    expect(result.case.sourceMode).toBe('synthetic');
    expect(result.checks.every(check => check.passed)).toBe(true);
    expect(result.sections.map(section => section.section)).toEqual(EVIDENCE_SECTIONS);
    expect(result.sections.every(section => section.sourceMode === 'synthetic')).toBe(true);
    expect(result.recordCount).toBeGreaterThan(3);
    expect(result.sections.flatMap(section => section.records).every(record => record.fields.orderRef === result.case.orderRef && record.fields.paymentRef === result.case.paymentRef)).toBe(true);
    expect(JSON.stringify(result.sections)).not.toMatch(/EXCLUDED_|private-buyer|private-renter|unrelated_record|other_merchant_record/);
  });

  it('supports rentals with no ticket mapping and preserves source-specific facts', () => {
    const template = getConnectorTemplate('rentul-rentals');
    const result = previewConnector(template.manifest, template.id);
    expect(result.sections.find(section => section.section === 'tickets')?.status).toBe('unavailable');
    expect(result.sections.find(section => section.section === 'attendance')?.records.map(record => record.fields.action)).toEqual(['collected', 'returned']);
    expect(result.sections.find(section => section.section === 'support')?.records[0].fields.message).toContain('Picked up');
  });

  it('respects removed sections and fields without changing the core', () => {
    const template = getConnectorTemplate('atmsphr-tickets');
    delete template.manifest.sections.attendance;
    delete template.manifest.sections.tickets!.fields.ticketType;
    const result = previewConnector(template.manifest, template.id);
    expect(result.sections.find(section => section.section === 'attendance')?.records).toEqual([]);
    expect(result.sections.find(section => section.section === 'tickets')?.records[0].fields).not.toHaveProperty('ticketType');
  });

  it('does not mutate template defaults across requests', () => {
    const copy = getConnectorTemplate('atmsphr-tickets');
    copy.manifest.order.table = 'changed';
    expect(getConnectorTemplate('atmsphr-tickets').manifest.order.table).toBe('orders');
  });

  it('rejects fields outside the approved sample schema and mismatched businesses', () => {
    const template = getConnectorTemplate('atmsphr-tickets');
    template.manifest.sections.tickets!.fields.contact = 'qr_secret';
    expect(() => previewConnector(template.manifest, template.id)).toThrow('outside the approved example schema');
    expect(() => previewConnector(getConnectorTemplate('rentul-rentals').manifest, 'atmsphr-tickets')).toThrow('selected example schema');
  });

  it('fails a mapping that does not actually match the case identity', () => {
    const template = getConnectorTemplate('atmsphr-tickets');
    [template.manifest.order.orderRef, template.manifest.order.paymentRef] = [template.manifest.order.paymentRef, template.manifest.order.orderRef];
    expect(() => previewConnector(template.manifest, template.id)).toThrow('could not be found');
  });
});

describe('approved, bounded query plans', () => {
  it('places all caller values in parameters and quotes identifiers', () => {
    const { manifest, grant } = context();
    grant.orderRef = "x' OR TRUE --"; grant.case.orderRef = grant.orderRef;
    const plan = buildReadPlan(manifest, grant, 'tickets', now)!;
    expect(plan.params).toEqual([grant.merchantId, grant.orderId, grant.orderRef, grant.paymentRef]);
    expect(plan.sql).not.toContain(grant.orderRef);
    expect(plan.sql).toContain('s."order_id" = o."id" AND s."merchant_id" = o."merchant_id"');
    expect(plan.sql).toContain('o."merchant_id" = $1 AND o."id" = $2 AND o."order_number" = $3 AND o."payment_ref" = $4');
    expect(plan.sql).toContain('LIMIT 13');
    expect(plan.sql).not.toContain('SELECT *');
    expect(plan.columns).not.toContain('qr_secret');
  });

  it.each(['orders; DELETE FROM users', 'public.orders', 'orders"', 'orders --', ''])('rejects identifier injection %s', table => {
    const { manifest } = context(); manifest.order.table = table;
    expect(connectorManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('rejects extra SQL, reserved output keys, ambiguous scope and excessive row limits', () => {
    const { manifest } = context();
    expect(connectorManifestSchema.safeParse({ ...manifest, sql: 'SELECT * FROM users' }).success).toBe(false);
    const reserved = structuredClone(manifest); reserved.sections.tickets!.fields.orderRef = 'status';
    expect(connectorManifestSchema.safeParse(reserved).success).toBe(false);
    const duplicate = structuredClone(manifest); duplicate.order.paymentRef = duplicate.order.orderRef;
    expect(connectorManifestSchema.safeParse(duplicate).success).toBe(false);
    const excessive = structuredClone(manifest); for (const mapping of Object.values(excessive.sections)) mapping!.limit = 25;
    expect(connectorManifestSchema.safeParse(excessive).success).toBe(false);
  });

  it('does not build a query for an unavailable source', () => {
    const { manifest, grant } = context();
    expect(buildReadPlan(manifest, grant, 'support', now)).toBeNull();
  });
});

describe('runtime scope and normalized evidence', () => {
  it('rejects another case, expired grant and revoked grant before database access', () => {
    const { manifest, grant } = context();
    expect(() => assertConnectorGrant(grant, 'another_case', now)).toThrow('does not authorize');
    expect(() => buildReadPlan(manifest, { ...grant, revoked: true }, 'summary', now)).toThrow('revoked');
    expect(() => buildReadPlan(manifest, { ...grant, expiresAt: now.toISOString() }, 'summary', now)).toThrow('expired');
  });

  it.each(['__scope_orderId', '__scope_merchantId', '__scope_orderRef', '__scope_paymentRef'])('rejects mismatched %s on returned source rows', field => {
    const { manifest, grant, child } = context();
    expect(() => normalizeConnectorSection(manifest, grant, 'tickets', [{ ...child, [field]: 'other' }], { sourceMode: 'synthetic', now })).toThrow('another order, merchant or payment');
  });

  it('publishes only approved fields and supports driver Date values', () => {
    const { manifest, grant, child } = context();
    const result = normalizeConnectorSection(manifest, grant, 'tickets', [{ ...child, occurredAt: new Date(child.occurredAt) }], { sourceMode: 'synthetic', now });
    expect(result.records[0].fields).toEqual({ orderRef: grant.orderRef, paymentRef: grant.paymentRef, status: 'issued', ticketType: 'General admission' });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN');
  });

  it('allows a partial dispute while checking order total, currency and purchase time', () => {
    const { manifest, grant, root } = context(); grant.case.amount = 2500;
    expect(normalizeConnectorSection(manifest, grant, 'summary', [root], { sourceMode: 'synthetic', now }).records[0].fields.totalMinorUnits).toBe(5000);
    for (const invalid of [{ ...root, amount: 2000 }, { ...root, currency: 'EUR' }, { ...root, purchasedAt: '2026-11-03T18:00:00Z' }]) expect(() => normalizeConnectorSection(manifest, grant, 'summary', [invalid], { sourceMode: 'synthetic', now })).toThrow('does not corroborate');
  });

  it('rejects duplicate purchases and duplicate source records', () => {
    const { manifest, grant, root, child } = context();
    expect(() => normalizeConnectorSection(manifest, grant, 'summary', [root, root], { sourceMode: 'synthetic', now })).toThrow('exactly one');
    expect(() => normalizeConnectorSection(manifest, grant, 'tickets', [child, child], { sourceMode: 'synthetic', now })).toThrow('more than once');
  });

  it('marks truncated reads and rejects unbounded results', () => {
    const { manifest, grant, child } = context(); manifest.sections.tickets!.limit = 1;
    const result = normalizeConnectorSection(manifest, grant, 'tickets', [child, { ...child, id: 'ticket_2' }], { sourceMode: 'synthetic', now });
    expect(result.status).toBe('partial'); expect(result.records).toHaveLength(1); expect(result.limitations).toContain('Only the first 1 linked records are included.');
    expect(() => normalizeConnectorSection(manifest, grant, 'tickets', [child, child, child], { sourceMode: 'synthetic', now })).toThrow('bounded read limit');
  });

  it('cannot relabel a synthetic grant as live', () => {
    const { manifest, grant, root } = context();
    expect(() => normalizeConnectorSection(manifest, grant, 'summary', [root], { sourceMode: 'live', now })).toThrow('source mode');
  });

  it('keeps source-based evidence ids stable when records are added or reordered', () => {
    const { manifest, grant, child } = context();
    const before = normalizeConnectorSection(manifest, grant, 'tickets', [child], { sourceMode: 'synthetic', now });
    const after = normalizeConnectorSection(manifest, grant, 'tickets', [{ ...child, id: 'earlier_ticket' }, child], { sourceMode: 'synthetic', now });
    expect(after.records[1].id).toBe(before.records[0].id);
    grant.caseId = 'c'.repeat(64); grant.case.id = grant.caseId;
    const longest = normalizeConnectorSection(manifest, grant, 'tickets', [{ ...child, id: 's'.repeat(160) }], { sourceMode: 'synthetic', now });
    expect(longest.records[0].id.length).toBeLessThanOrEqual(240);
    grant.caseId += 'c'; grant.case.id = grant.caseId;
    expect(() => assertConnectorGrant(grant, grant.caseId, now)).toThrow('incomplete');
  });

  it('emits the existing live merchant contract when given a separately verified live grant', () => {
    const { manifest, grant, root } = context(); grant.case.sourceMode = 'live';
    const result = normalizeConnectorSection(manifest, grant, 'summary', [root], { sourceMode: 'live', now });
    const parsed = normalizeMerchantSection(envelopeToWire(result, grant.case), grant.caseId, 'summary');
    expect(parsed.mappingVerified).toBe(true); expect(parsed.case?.paymentRef).toBe(grant.paymentRef);
    expect(() => envelopeToWire(result)).toThrow('matching case metadata');
  });
});
