import { z } from 'zod';
import { ApiError } from './types.ts';
import { projectRef, querySupabaseReadOnly } from './supabase-api.ts';
import type { OrderEvidenceMapping, SchemaTable, LinkedEvidenceRecord } from '../lib/providers/types.ts';
import { createHash } from 'node:crypto';

const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
const columns = z.array(identifier).min(1).max(8).refine(values => new Set(values).size === values.length);
export const orderMappingSchema = z.object({
  order: z.object({ table: identifier, idColumn: identifier, paymentColumn: identifier, paymentKind: z.enum(['payment_intent', 'charge']), customerEmailColumn: identifier.optional(), columns }).strict(),
  related: z.array(z.object({ section: z.enum(['tickets', 'delivery', 'history', 'attendance', 'support']), table: identifier, orderColumn: identifier, columns }).strict()).max(3),
}).strict();
const sensitive = /password|passwd|secret|token|qr.?code|qr.?payload|barcode|private.?key|api.?key|cvv|cvc|card.?number/i;
export function validateOrderMapping(input: unknown, approved: SchemaTable[], schema: SchemaTable[]): OrderEvidenceMapping {
  const parsed = orderMappingSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose valid order and related-record columns.', 'mapping_invalid');
  const mapping = parsed.data;
  if (!mapping.order.columns.includes(mapping.order.idColumn) || !mapping.order.columns.includes(mapping.order.paymentColumn) || mapping.order.idColumn === mapping.order.paymentColumn || (mapping.order.customerEmailColumn && !mapping.order.columns.includes(mapping.order.customerEmailColumn))) throw new ApiError(400, 'Include distinct order ID and Stripe payment columns, plus any mapped customer email, in the order fields.', 'mapping_invalid');
  if (new Set(mapping.related.map(r => r.table)).size !== mapping.related.length || mapping.related.some(r => r.table === mapping.order.table || !r.columns.includes(r.orderColumn))) throw new ApiError(400, 'Choose distinct related tables and include each order-link column.', 'mapping_invalid');
  for (const table of [mapping.order, ...mapping.related]) {
    const allowed = approved.find(t => t.name === table.table), live = schema.find(t => t.name === table.table);
    if (sensitive.test(table.table) || !allowed || !live || table.columns.some(c => sensitive.test(c) || !allowed.columns.includes(c) || !live.columns.includes(c))) throw new ApiError(400, 'Use only approved, current evidence columns. Credentials and ticket access codes are excluded.', 'mapping_scope_denied');
  }
  return mapping;
}
const quote = (name: string) => { if (!identifier.safeParse(name).success) throw new ApiError(400, 'Invalid mapped identifier.', 'mapping_invalid'); return `"${name}"`; };
const rowSchema = z.record(z.string(), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]));
export function evidenceQuery(table: string, selected: string[], filterColumn: string, limit: number) {
  if (!columns.safeParse(selected).success || ![2, 6].includes(limit)) throw new ApiError(400, 'Invalid mapped query.', 'mapping_invalid');
  return `SELECT ${selected.map(quote).join(', ')} FROM public.${quote(table)} WHERE ${quote(filterColumn)}::text = $1 LIMIT ${limit}`;
}
async function rows(accessToken: string, ref: string, table: string, selected: string[], filter: string, value: string, limit: 2 | 6) {
  const result = z.array(rowSchema).max(limit).safeParse(await querySupabaseReadOnly(accessToken, ref, evidenceQuery(table, selected, filter, limit), [value]));
  if (!result.success || result.data.some(row => Object.keys(row).length !== selected.length || selected.some(c => !Object.hasOwn(row, c)) || Object.keys(row).some(c => !selected.includes(c)))) throw new ApiError(422, 'Mapped records must contain only the selected scalar fields, at most 1,000 characters each. Exclude JSON, attachments and large text.', 'mapping_record_invalid');
  if (JSON.stringify(result.data).includes(accessToken)) throw new ApiError(502, 'The provider returned unsafe content.', 'provider_invalid_response');
  return result.data;
}
export async function fetchMappedEvidence(accessToken: string, ref: string, input: OrderEvidenceMapping, paymentRef: string) {
  if (!projectRef.safeParse(ref).success || !orderMappingSchema.safeParse(input).success || !/^(?:pi|ch|py)_[A-Za-z0-9]{1,120}$/.test(paymentRef)) throw new ApiError(400, 'A verified Stripe payment and saved mapping are required.', 'mapping_invalid');
  const root = input.order;
  const orders = await rows(accessToken, ref, root.table, root.columns, root.paymentColumn, paymentRef, 2);
  if (orders.length !== 1) throw new ApiError(409, orders.length ? 'Multiple orders match this payment. Fix the mapping before importing.' : 'No order matches the verified Stripe payment.', 'mapping_order_unresolved');
  const orderId = orders[0][root.idColumn];
  if ((typeof orderId !== 'string' && typeof orderId !== 'number') || !String(orderId).trim() || String(orderId).length > 200 || String(orders[0][root.paymentColumn]) !== paymentRef) throw new ApiError(409, 'The mapped order has no usable identity or payment link.', 'mapping_order_unresolved');
  // Require a globally unique order ID in this table before using it as a child filter.
  const unique = await rows(accessToken, ref, root.table, [root.idColumn, root.paymentColumn], root.idColumn, String(orderId), 2);
  if (unique.length !== 1 || String(unique[0][root.idColumn]) !== String(orderId) || String(unique[0][root.paymentColumn]) !== paymentRef) throw new ApiError(409, 'Order IDs are not unique across this table. A tenant-aware mapping is required.', 'mapping_order_unresolved');
  const limitations = ['Only the approved fields and direct order-linked tables were queried. Other records may exist.'];
  if (root.customerEmailColumn && !z.string().email().max(254).safeParse(orders[0][root.customerEmailColumn]).success) limitations.push('The mapped order email is absent or invalid. No customer email will be filled from this snapshot.');
  const records: LinkedEvidenceRecord[] = [];
  const record = (section: string, table: string, fields: z.infer<typeof rowSchema>) => ({ id: createHash('sha256').update(JSON.stringify([ref, table, paymentRef, section, fields])).digest('hex'), section, table, fields });
  records.push(record('order', root.table, orders[0]));
  const related = await Promise.all(input.related.map(async relation => ({ relation, values: await rows(accessToken, ref, relation.table, relation.columns, relation.orderColumn, String(orderId), 6) })));
  for (const { relation, values } of related) {
    if (values.some(row => String(row[relation.orderColumn]) !== String(orderId))) throw new ApiError(502, 'The provider returned unrelated records.', 'provider_invalid_response');
    if (values.length > 5) limitations.push(`${relation.table}: only five related records are shown; more exist.`);
    if (!values.length) limitations.push(`${relation.table}: no matching rows returned. This does not establish that the event did not occur.`);
    for (const fields of values.slice(0, 5)) records.push(record(relation.section, relation.table, fields));
  }
  return { records: [...new Map(records.map(r => [r.id, r])).values()], limitations };
}
