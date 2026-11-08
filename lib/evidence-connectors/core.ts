import { z } from 'zod';
import { EVIDENCE_SECTIONS, type EvidenceEnvelope, type EvidenceSection } from '../investigation/types.ts';
import type { ConnectorCase, ConnectorGrant, ConnectorManifest, ConnectorReadPlan } from './types.ts';

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/, 'Use a single PostgreSQL identifier, without SQL or punctuation.');
const safeField = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/).refine(value => !['constructor', 'prototype', 'orderRef', 'paymentRef', 'merchantId', 'orderId'].includes(value), 'This field is reserved for case scope.');
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
// Keep case + section + source id within the merchant API's 240-character evidence id.
const caseId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'Connector case identifiers must be at most 64 characters.');
const date = z.string().datetime({ offset: true });
const text = z.string().min(1).max(200);
const scalar = z.union([z.string().max(6000), z.number().finite(), z.boolean(), z.null()]);
const orderSchema = z.object({ table: identifier, id: identifier, merchantId: identifier, orderRef: identifier, paymentRef: identifier, amount: identifier, currency: identifier, purchasedAt: identifier }).strict();
const sectionSchema = z.object({
  table: identifier, id: identifier, orderId: identifier, merchantId: identifier, occurredAt: identifier,
  title: z.string().min(1).max(200), detail: z.string().min(1).max(1000),
  fields: z.record(safeField, identifier).refine(fields => Object.keys(fields).length > 0 && Object.keys(fields).length <= 16, 'Choose between 1 and 16 readable fields.'),
  limit: z.number().int().min(1).max(25),
}).strict();

export const connectorManifestSchema: z.ZodType<ConnectorManifest> = z.object({
  version: z.literal(1), id, name: z.string().trim().min(1).max(100), businessType: z.enum(['tickets', 'rentals']), schema: identifier,
  order: orderSchema,
  sections: z.object({ tickets: sectionSchema.optional(), delivery: sectionSchema.optional(), history: sectionSchema.optional(), support: sectionSchema.optional(), attendance: sectionSchema.optional(), policy: sectionSchema.optional() }).strict(),
}).strict().superRefine((manifest, ctx) => {
  if (Object.values(manifest.sections).reduce((sum, mapping) => sum + (mapping?.limit ?? 0), 0) > 88) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'A case can expose at most 90 records including its summary and order.' });
  const scopeColumns = [manifest.order.id, manifest.order.merchantId, manifest.order.orderRef, manifest.order.paymentRef];
  if (new Set(scopeColumns).size !== scopeColumns.length) ctx.addIssue({ code: 'custom', path: ['order'], message: 'Order, merchant, order reference and payment reference must use distinct columns.' });
  for (const [section, mapping] of Object.entries(manifest.sections)) {
    if (mapping && mapping.orderId === mapping.merchantId) ctx.addIssue({ code: 'custom', path: ['sections', section], message: 'Order and merchant must use distinct columns.' });
  }
});

const caseSchema: z.ZodType<ConnectorCase> = z.object({
  id: caseId, merchantId: text, merchantName: text, customerLabel: text, claim: z.string().min(1).max(6000), reason: text,
  amount: z.number().int().min(0).max(1000000000), currency: z.string().regex(/^[A-Za-z]{3}$/),
  eventName: z.string().min(1).max(240), purchasedAt: date, openedAt: date, dueAt: date,
  sourceMode: z.enum(['live', 'attached', 'anonymized_snapshot', 'synthetic']), summary: z.string().max(6000),
  orderRef: text, paymentRef: text, tags: z.array(z.string().max(80)).max(12),
}).strict();
export const connectorGrantSchema: z.ZodType<ConnectorGrant> = z.object({
  caseId, merchantId: text, orderId: text, orderRef: text, paymentRef: text, expiresAt: date, revoked: z.boolean(), case: caseSchema,
}).strict();

export const parseConnectorManifest = (input: unknown): ConnectorManifest => connectorManifestSchema.parse(input);

export class ConnectorError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ConnectorError'; }
}

export function assertConnectorGrant(input: ConnectorGrant, requestedCaseId: string, now = new Date()): ConnectorGrant {
  const parsed = connectorGrantSchema.safeParse(input);
  if (!parsed.success) throw new ConnectorError('invalid_grant', 'The approved case grant is incomplete.');
  const grant = parsed.data;
  if (grant.revoked || Date.parse(grant.expiresAt) <= now.getTime()) throw new ConnectorError('access_denied', 'The case grant has expired or been revoked.');
  if (grant.caseId !== requestedCaseId || grant.case.id !== grant.caseId || grant.case.merchantId !== grant.merchantId || grant.case.orderRef !== grant.orderRef || grant.case.paymentRef !== grant.paymentRef) throw new ConnectorError('scope_mismatch', 'This grant does not authorize the requested case or payment.');
  return grant;
}

/** Only approved identifiers enter SQL text. Case values always remain parameters. */
export function quoteIdentifier(value: string): string { return `"${identifier.parse(value)}"`; }
const column = (alias: 'o' | 's', name: string) => `${alias}.${quoteIdentifier(name)}`;
const table = (manifest: ConnectorManifest, name: string) => `${quoteIdentifier(manifest.schema)}.${quoteIdentifier(name)}`;
const rootScope = (manifest: ConnectorManifest) => `${column('o', manifest.order.merchantId)} = $1 AND ${column('o', manifest.order.id)} = $2 AND ${column('o', manifest.order.orderRef)} = $3 AND ${column('o', manifest.order.paymentRef)} = $4`;
const scopeAliases = (manifest: ConnectorManifest) => [
  `${column('o', manifest.order.id)} AS "__scope_orderId"`, `${column('o', manifest.order.merchantId)} AS "__scope_merchantId"`,
  `${column('o', manifest.order.orderRef)} AS "__scope_orderRef"`, `${column('o', manifest.order.paymentRef)} AS "__scope_paymentRef"`,
];

export function buildReadPlan(input: ConnectorManifest, inputGrant: ConnectorGrant, section: EvidenceSection, now = new Date()): ConnectorReadPlan | null {
  const manifest = connectorManifestSchema.parse(input);
  const grant = assertConnectorGrant(inputGrant, inputGrant.caseId, now);
  if (!EVIDENCE_SECTIONS.includes(section)) throw new ConnectorError('invalid_section', 'This evidence section is not supported.');
  const params = [grant.merchantId, grant.orderId, grant.orderRef, grant.paymentRef];
  if (section === 'summary' || section === 'order') {
    const fields = Object.entries(manifest.order).filter(([name]) => name !== 'table');
    const selected = [...scopeAliases(manifest), ...fields.map(([name, source]) => `${column('o', source)} AS ${quoteIdentifier(name)}`)];
    return { section, sql: `SELECT ${selected.join(', ')} FROM ${table(manifest, manifest.order.table)} o WHERE ${rootScope(manifest)} LIMIT 2`, params, limit: 1, table: manifest.order.table, columns: [...new Set(fields.map(([, source]) => source))] };
  }
  const mapping = manifest.sections[section];
  if (!mapping) return null;
  const selected = [...scopeAliases(manifest), `${column('s', mapping.id)} AS "id"`, `${column('s', mapping.occurredAt)} AS "occurredAt"`, ...Object.entries(mapping.fields).map(([, source], index) => `${column('s', source)} AS "f_${index}"`)];
  // Both joins are necessary even when order identifiers are only unique within a merchant.
  const join = `${column('s', mapping.orderId)} = ${column('o', manifest.order.id)} AND ${column('s', mapping.merchantId)} = ${column('o', manifest.order.merchantId)}`;
  return { section, sql: `SELECT ${selected.join(', ')} FROM ${table(manifest, mapping.table)} s JOIN ${table(manifest, manifest.order.table)} o ON ${join} WHERE ${rootScope(manifest)} ORDER BY ${column('s', mapping.occurredAt)}, ${column('s', mapping.id)} LIMIT ${mapping.limit + 1}`, params, limit: mapping.limit, table: mapping.table, columns: [...new Set([mapping.id, mapping.orderId, mapping.merchantId, mapping.occurredAt, ...Object.values(mapping.fields)])] };
}

const timestamp = (value: unknown): string => date.parse(value instanceof Date ? value.toISOString() : value);
function validateScope(row: Record<string, unknown>, grant: ConnectorGrant) {
  if (row.__scope_orderId !== grant.orderId || row.__scope_merchantId !== grant.merchantId || row.__scope_orderRef !== grant.orderRef || row.__scope_paymentRef !== grant.paymentRef) throw new ConnectorError('scope_mismatch', 'A source record belongs to another order, merchant or payment.');
}

export function normalizeConnectorSection(input: ConnectorManifest, inputGrant: ConnectorGrant, section: EvidenceSection, rows: Record<string, unknown>[], options: { sourceMode: 'live' | 'synthetic'; now?: Date }): EvidenceEnvelope {
  const manifest = connectorManifestSchema.parse(input);
  const now = options.now ?? new Date();
  const grant = assertConnectorGrant(inputGrant, inputGrant.caseId, now);
  if (grant.case.sourceMode !== options.sourceMode) throw new ConnectorError('mode_mismatch', 'The source mode must match the approved case.');
  const plan = buildReadPlan(manifest, grant, section, now);
  if (!Array.isArray(rows) || rows.length > (plan ? plan.limit + 1 : 0)) throw new ConnectorError('row_limit', 'The source exceeded its bounded read limit.');
  const limitations: string[] = options.sourceMode === 'synthetic' ? ['Fictional onboarding data. No customer database was queried.'] : [];
  const result: EvidenceEnvelope = { caseId: grant.caseId, section, sourceMode: options.sourceMode, fetchedAt: now.toISOString(), status: 'available', records: [], limitations };
  if (!plan || rows.length === 0) {
    if (section === 'summary' || section === 'order') throw new ConnectorError('case_not_found', 'The approved order and payment could not be found.');
    result.status = 'unavailable';
    limitations.push(plan ? 'No linked records were found. This does not prove the event did not happen.' : 'This source is not mapped or shared by the business.');
    return result;
  }
  for (const row of rows) validateScope(row, grant);
  if (section === 'summary' || section === 'order') {
    if (rows.length !== 1) throw new ConnectorError('ambiguous_order', 'The order mapping must identify exactly one purchase.');
    const row = rows[0];
    const amount = z.number().int().min(0).max(1000000000).parse(row.amount);
    const currency = z.string().regex(/^[A-Za-z]{3}$/).parse(row.currency).toUpperCase();
    const purchasedAt = timestamp(row.purchasedAt);
    if (row.id !== grant.orderId || row.merchantId !== grant.merchantId || row.orderRef !== grant.orderRef || row.paymentRef !== grant.paymentRef || grant.case.amount > amount || grant.case.currency.toUpperCase() !== currency || Date.parse(purchasedAt) !== Date.parse(grant.case.purchasedAt)) throw new ConnectorError('mapping_mismatch', 'The order does not corroborate the approved case metadata.');
    result.records.push({ id: `${grant.caseId}:${section}:1`, source: `${manifest.schema}.${manifest.order.table}`, sourceId: grant.orderId, occurredAt: purchasedAt,
      title: section === 'summary' ? 'Approved disputed purchase' : 'Recorded purchase', detail: 'This record links the approved merchant, order and payment. Purchase alone does not prove fulfillment.',
      fields: { orderId: grant.orderId, merchantId: grant.merchantId, orderRef: grant.orderRef, paymentRef: grant.paymentRef, totalMinorUnits: amount, currency } });
    return result;
  }
  const mapping = manifest.sections[section]!;
  const ids = new Set<string>();
  for (const row of rows) {
    const sourceId = z.string().min(1).max(160).regex(/^[^\[\]\r\n]+$/).parse(row.id);
    if (ids.has(sourceId)) throw new ConnectorError('duplicate_record', 'A section returned the same source record more than once.');
    ids.add(sourceId);
    const fields: Record<string, string | number | boolean | null> = { orderRef: grant.orderRef, paymentRef: grant.paymentRef };
    Object.keys(mapping.fields).forEach((name, index) => { const value = row[`f_${index}`]; fields[name] = scalar.parse(value instanceof Date ? value.toISOString() : value); });
    const occurredAt = timestamp(row.occurredAt);
    if (result.records.length < plan.limit) result.records.push({ id: `${grant.caseId}:${section}:${sourceId}`, source: `${manifest.schema}.${mapping.table}`, sourceId, occurredAt, title: mapping.title, detail: mapping.detail, fields });
  }
  if (rows.length > plan.limit) { limitations.push(`Only the first ${plan.limit} linked records are included.`); result.status = 'partial'; }
  if (section === 'delivery') { limitations.push('A recorded send or provider acceptance does not establish inbox delivery or reading.'); result.status = 'partial'; }
  if (section === 'attendance') { limitations.push('A missing scan or handoff record does not establish nonattendance or nonfulfillment.'); result.status = 'partial'; }
  return result;
}

/** Live callers must independently verify the dispute/payment link before publishing this wire result. */
export function envelopeToWire(envelope: EvidenceEnvelope, metadata?: ConnectorCase) {
  if (envelope.section === 'summary' && (!metadata || metadata.id !== envelope.caseId || metadata.sourceMode !== envelope.sourceMode)) throw new ConnectorError('missing_metadata', 'A summary needs matching case metadata.');
  return { case_id: envelope.caseId, section: envelope.section, source_mode: envelope.sourceMode, fetched_at: envelope.fetchedAt, status: envelope.status,
    records: envelope.records.map(record => ({ evidence_id: record.id, source: record.source, source_id: record.sourceId, occurred_at: record.occurredAt, data: { title: record.title, detail: record.detail, fields: record.fields } })), limitations: envelope.limitations,
    ...(envelope.section === 'summary' ? { mapping_verified: true, case: metadata } : {}),
  };
}
