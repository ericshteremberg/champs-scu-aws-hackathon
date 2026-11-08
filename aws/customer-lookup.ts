import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError, type StoreChange, type Stored, type TrustedUser } from './types.ts';
import { commit, getItem } from './store.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, now, ownedCase, requireWorkspace } from './workspace.ts';
import { supabaseProviderAccess } from './providers.ts';
import { fetchSupabaseSchema, querySupabaseReadOnly } from './supabase-api.ts';
import type { CustomerLookupMapping, CustomerMatch, SchemaTable } from '../lib/providers/types.ts';

const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
const mappingSchema = z.object({ table: identifier, idColumn: identifier, nameColumn: identifier, emailColumn: identifier }).strict().refine(m => new Set([m.idColumn, m.nameColumn, m.emailColumn]).size === 3);
export const customerActions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('customer_config') }).strict(),
  z.object({ action: z.literal('customer_save_mapping'), mapping: mappingSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('customer_lookup'), caseId: z.string().min(1).max(200), query: z.string().trim().min(3).max(100).refine(s => !/[\x00-\x1f\x7f]/.test(s)) }).strict(),
  z.object({ action: z.literal('customer_select'), caseId: z.string().min(1).max(200), lookupId: z.string().uuid(), matchId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
]);
type Mapping = { mapping: CustomerLookupMapping; projectRef: string; connectionVersion: number };
type Selection = { id: string; matches: CustomerMatch[]; caseVersion: number; mappingVersion: number; connectionVersion: number; ttlEpochSeconds: number };
const mappingKey = 'provider-customer-mapping#supabase';
const sensitive = /password|passwd|secret|token|qr.?code|qr.?payload|barcode|private.?key|api.?key|cvv|cvc|card.?number/i;
const fields = (m: CustomerLookupMapping) => [m.idColumn, m.nameColumn, m.emailColumn];
function validate(m: CustomerLookupMapping, tables: SchemaTable[]) {
  const table = tables.find(t => t.name === m.table);
  if (!mappingSchema.safeParse(m).success || sensitive.test(m.table) || !table || fields(m).some(c => sensitive.test(c) || !table.columns.includes(c))) throw new ApiError(409, 'Choose current approved ID, name and email columns.', 'customer_mapping_invalid');
}
const guard = (...rows: Stored<unknown>[]): StoreChange[] => rows.map(row => ({ key: row.key, expectedVersion: row.version, check: true }));
const quote = (s: string) => `"${identifier.parse(s)}"`;
export function customerQuery(mapping: CustomerLookupMapping, query: string) {
  mappingSchema.parse(mapping);
  const escaped = (s: string) => s.replace(/[\\%_]/g, '\\$&');
  const parts = query.trim().split(/\s+/).slice(0, 5);
  const name = parts.map((_, i) => `${quote(mapping.nameColumn)}::text ILIKE $${i + 2} ESCAPE E'\\\\'`).join(' AND ');
  return { sql: `SELECT ${fields(mapping).map(quote).join(', ')} FROM public.${quote(mapping.table)} WHERE (${quote(mapping.emailColumn)}::text ILIKE $1 ESCAPE E'\\\\' OR (${name})) ORDER BY ${quote(mapping.idColumn)} LIMIT 6`, parameters: [`%${escaped(query)}%`, ...parts.map(s => `%${escaped(s)}%`)] };
}
export async function customerLookupAction(user: TrustedUser, input: unknown) {
  const parsed = customerActions.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a valid customer lookup action.', 'invalid_request');
  const action = parsed.data, wid = (await requireWorkspace(user)).data.id;
  const access = await supabaseProviderAccess(wid), connection = access.connection;
  const project = connection.data.project;
  if (!project) throw new ApiError(409, 'Select your Supabase project in Connections first.', 'customer_project_required');
  const saved = await getItem<Mapping>(wid, mappingKey);
  const current = saved?.data.projectRef === project.ref && saved.data.connectionVersion === connection.version;
  const connections = guard(connection, access.token);
  if (action.action === 'customer_config' || action.action === 'customer_save_mapping') {
    const schema = (await fetchSupabaseSchema(access.token.data.accessToken, project.ref)).filter(t => !sensitive.test(t.name)).map(t => ({ ...t, columns: t.columns.filter(c => !sensitive.test(c)) }));
    if (action.action === 'customer_config') {
      await commit(wid, connections);
      return { projectName: project.name, tables: schema, mapping: current ? saved!.data.mapping : null };
    }
    validate(action.mapping, schema);
    const approved = connection.data.approvedTables || [], prior = approved.find(t => t.name === action.mapping.table);
    const added = fields(action.mapping).some(c => !prior?.columns.includes(c));
    const approvedTables = prior ? approved.map(t => t.name === prior.name ? { ...t, columns: [...new Set([...t.columns, ...fields(action.mapping)])] } : t) : [...approved, { name: action.mapping.table, columns: fields(action.mapping) }];
    if (approvedTables.length > 30 || approvedTables.some(t => t.columns.length > 100)) throw new ApiError(409, 'The approved column scope is full. Review it before adding a customer lookup.', 'customer_scope_limit');
    await commit(wid, [
      ...(added ? [...guard(access.token), { key: connection.key, expectedVersion: connection.version, data: { ...connection.data, approvedTables, updatedAt: now() } } satisfies StoreChange] : connections),
      { key: mappingKey, expectedVersion: saved?.version ?? null, data: { mapping: action.mapping, projectRef: project.ref, connectionVersion: connection.version + (added ? 1 : 0) } satisfies Mapping },
      auditChange(user, 'provider.customer_mapping_saved', 'Approved the selected customer ID, name and email columns for read-only customer lookup.'),
    ]);
    return { mapping: action.mapping };
  }
  if (!saved || !current) throw new ApiError(409, 'Set up the customer lookup for the current Supabase project and permissions first.', 'customer_mapping_required');
  validate(saved.data.mapping, connection.data.approvedTables || []);
  const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
  const selectionKey = `customer-lookup#${row.data.id}`;
  const checks = [...connections, ...guard(saved)];
  if (action.action === 'customer_lookup') {
    validate(saved.data.mapping, await fetchSupabaseSchema(access.token.data.accessToken, project.ref));
    const { sql, parameters } = customerQuery(saved.data.mapping, action.query);
    const raw = await querySupabaseReadOnly(access.token.data.accessToken, project.ref, sql, parameters);
    const checked = z.array(z.record(z.string(), z.union([z.string().max(1000), z.number().finite(), z.null()]))).max(6).safeParse(raw);
    const selected = fields(saved.data.mapping);
    if (!checked.success || checked.data.some(r => Object.keys(r).length !== 3 || selected.some(c => !Object.hasOwn(r, c))) || JSON.stringify(checked.data).includes(access.token.data.accessToken)) throw new ApiError(502, 'Supabase returned an unsupported customer record.', 'provider_invalid_response');
    const matches: CustomerMatch[] = [];
    for (const r of checked.data.slice(0, 5)) {
      const email = z.string().trim().email().max(254).safeParse(r[saved.data.mapping.emailColumn]);
      const name = r[saved.data.mapping.nameColumn], sourceId = r[saved.data.mapping.idColumn];
      if (!email.success || typeof name !== 'string' || name.length > 200 || sourceId === null || String(sourceId).length > 200) continue;
      matches.push({ id: randomUUID(), sourceId: String(sourceId), name, email: email.data });
    }
    const id = randomUUID(), prior = await getItem<Selection>(wid, selectionKey);
    await commit(wid, [...checks, ...guard(row), { key: selectionKey, expectedVersion: prior?.version ?? null, data: { id, matches, caseVersion: row.version, mappingVersion: saved.version, connectionVersion: connection.version, ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Selection }]);
    return { lookupId: id, matches, moreAvailable: checked.data.length > 5, skippedInvalid: checked.data.slice(0, 5).length - matches.length, table: saved.data.mapping.table };
  }
  const selection = await getItem<Selection>(wid, selectionKey);
  const match = selection?.data.matches.find(m => m.id === action.matchId);
  if (!selection || !match || selection.data.id !== action.lookupId || selection.data.caseVersion !== row.version || selection.data.mappingVersion !== saved.version || selection.data.connectionVersion !== connection.version || selection.data.ttlEpochSeconds <= Date.now() / 1000) throw new ApiError(409, 'Look up this customer again. The case, mapping or permissions changed, or the lookup expired.', 'customer_lookup_expired');
  const emailChanged = row.data.email.trim().toLowerCase() !== match.email.toLowerCase();
  const draft = emailChanged ? await getDraft(wid, row.data.id) : null;
  const changes: StoreChange[] = [...checks, { key: selection.key, expectedVersion: selection.version, delete: true }, ...(emailChanged ? [caseChange(row, { ...row.data, email: match.email, updatedAt: now(), dataRevision: row.data.dataRevision + 1, status: 'needs_review' })] : guard(row)), auditChange(user, 'provider.customer_email_selected', `Selected a reviewed customer email from Supabase public.${saved.data.mapping.table}. A name match does not verify cardholder identity. ${emailChanged ? 'Prior draft approval cleared.' : 'The existing email and draft were unchanged.'}`, row.data.id)];
  if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
  await commit(wid, changes);
  return { email: match.email, caseId: row.data.id };
}
