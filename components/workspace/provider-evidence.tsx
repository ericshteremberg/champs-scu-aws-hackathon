"use client";

import { useEffect, useState } from 'react';
import { FileSearch } from 'lucide-react';
import type { WorkspaceState } from '../../lib/domain';
import type { LinkedEvidencePreview, OrderEvidenceMapping, ProviderStatus, SchemaTable, StripeDisputeSummary } from '../../lib/providers/types';
import { formatMoney } from '../../lib/money';

type EvidenceStatus = { mapping: OrderEvidenceMapping | null; eligibleCaseIds: string[] };
const blankMapping = (): OrderEvidenceMapping => ({ order: { table: '', idColumn: '', paymentColumn: '', paymentKind: 'payment_intent', columns: [] }, related: [] });
async function api<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/providers/evidence', { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || 'Evidence could not be loaded. Try again.');
  return value;
}
const sensitive = /password|passwd|secret|token|qr.?code|qr.?payload|barcode|private.?key|api.?key|cvv|cvc|card.?number/i;
function Columns({ table, value, onChange }: { table?: SchemaTable; value: string[]; onChange: (columns: string[]) => void }) {
  return <div className="cw-provider-columns">{table?.columns.map(column => <label key={column}><input type="checkbox" checked={value.includes(column)} disabled={!value.includes(column) && value.length >= 8} onChange={() => onChange(value.includes(column) ? value.filter(c => c !== column) : [...value, column])} />{column}</label>)}</div>;
}
function ColumnSelect({ label, table, value, onChange }: { label: string; table?: SchemaTable; value: string; onChange: (column: string) => void }) {
  return <label className="cw-field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}><option value="">Choose column</option>{table?.columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>;
}
export function ProviderEvidence({ status, cases, onImported }: { status: ProviderStatus; cases: WorkspaceState['cases']; onImported: (state: WorkspaceState, caseId: string) => void }) {
  const [saved, setSaved] = useState<EvidenceStatus>({ mapping: null, eligibleCaseIds: [] });
  const [mapping, setMapping] = useState<OrderEvidenceMapping>(blankMapping);
  const [disputes, setDisputes] = useState<StripeDisputeSummary[] | null>(null);
  const [disputeId, setDisputeId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [preview, setPreview] = useState<LinkedEvidencePreview | null>(null);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const stripeReady = status.stripe.connection?.status === 'authorized';
  const supabaseReady = status.supabase.connection?.status === 'authorized' && !!status.supabase.connection.project && !!status.supabase.connection.approvedTables?.length;
  const tables = (status.supabase.connection?.approvedTables || []).filter(t => !sensitive.test(t.name)).map(t => ({ ...t, columns: t.columns.filter(c => !sensitive.test(c)) })).filter(t => t.columns.length);
  const eligible = cases.filter(c => saved.eligibleCaseIds.includes(c.id) && ['needs_review', 'investigating', 'ready'].includes(c.status));
  const orderTable = tables.find(t => t.name === mapping.order.table);
  const currentDispute = disputes?.find(d => d.id === disputeId);
  const actionable = currentDispute && ['needs_response', 'warning_needs_response'].includes(currentDispute.status);
  useEffect(() => {
    let alive = true;
    api<EvidenceStatus>().then(value => { if (alive) { setSaved(value); setMapping(value.mapping || blankMapping()); } }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setBusy(''); });
    return () => { alive = false; };
  }, []);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'The request failed.'); }
    finally { setBusy(''); }
  };
  const openCase = async (id: string) => {
    const response = await fetch('/api/workspace', { cache: 'no-store' });
    if (!response.ok) throw new Error('The import completed. Refresh the workspace to open the case.');
    onImported(await response.json(), id);
  };
  const setOrder = (fields: Partial<OrderEvidenceMapping['order']>) => { setPreview(null); setMapping(value => ({ ...value, order: { ...value.order, ...fields } })); };
  const setRelated = (index: number, fields: Partial<OrderEvidenceMapping['related'][number]>) => { setPreview(null); setMapping(value => ({ ...value, related: value.related.map((r, i) => i === index ? { ...r, ...fields } : r) })); };
  const mappingChanged = JSON.stringify(mapping) !== JSON.stringify(saved.mapping);
  return <article className="cw-provider-card cw-evidence-card" aria-label="Disputes and linked evidence">
    <h3><FileSearch size={20} />Disputes and linked evidence</h3>
    <p>Match a Stripe dispute to its order records.</p>
    {error && <p className="cw-banner error" role="alert">{error}</p>}
    {notice && <p className="cw-banner neutral" role="status">{notice}</p>}
    <fieldset className="cw-provider-scope" disabled={!!busy || !stripeReady}><legend>1. Choose a Stripe dispute</legend>
      {!stripeReady && <p>Connect Stripe above to load disputes.</p>}
      <button className="cw-button" onClick={() => void run('list', async () => { setDisputeId(''); const result = await api<{ disputes: StripeDisputeSummary[]; moreAvailable: boolean }>({ action: 'stripe_disputes' }); setDisputes(result.disputes); setNotice(result.moreAvailable ? 'Showing the ten latest disputes. Older disputes are outside this preview.' : result.disputes.length ? 'Choose a dispute awaiting a response.' : 'No disputes were returned for this Stripe account and environment.'); })}>Load Stripe disputes</button>
      {disputes && disputes.length > 0 && <>
        <label className="cw-field"><span>Stripe dispute</span><select value={disputeId} onChange={e => setDisputeId(e.target.value)}><option value="">Choose a dispute</option>{disputes.map(d => <option key={d.id} value={d.id}>{d.id} · {formatMoney(d.amount, d.currency)} · {d.reason} · {d.status}</option>)}</select></label>
        {currentDispute && <p>{currentDispute.dueAt ? `Response due: ${new Date(currentDispute.dueAt).toLocaleString()}.` : 'Stripe returned no response deadline.'} Importing creates a local case. Nothing is submitted to Stripe.</p>}
        <button className="cw-button primary" disabled={!actionable} onClick={() => void run('dispute', async () => { const result = await api<{ caseId: string }>({ action: 'import_stripe_dispute', disputeId, confirmed: true }); await openCase(result.caseId); })}>Import and open case</button>
      </>}
    </fieldset>
    <fieldset className="cw-provider-scope" disabled={!!busy || !stripeReady || !supabaseReady}><legend>2. Map your approved evidence tables</legend>
      {!supabaseReady && <p>Select your Supabase project and approve columns above first.</p>}
      <p className="cw-provider-note">Map the order ID and Stripe payment ID. Related tables must link to that order.</p>
      <label className="cw-field"><span>Order table</span><select value={mapping.order.table} onChange={e => setOrder({ table: e.target.value, idColumn: '', paymentColumn: '', customerEmailColumn: undefined, columns: [] })}><option value="">Choose table</option>{tables.map(t => <option key={t.name}>{t.name}</option>)}</select></label>
      {orderTable && <>
        <div className="cw-evidence-fields"><ColumnSelect label="Order ID column" table={orderTable} value={mapping.order.idColumn} onChange={idColumn => setOrder({ idColumn })} /><ColumnSelect label="Stripe payment column" table={orderTable} value={mapping.order.paymentColumn} onChange={paymentColumn => setOrder({ paymentColumn })} />
          <label className="cw-field"><span>Stored Stripe ID type</span><select value={mapping.order.paymentKind} onChange={e => setOrder({ paymentKind: e.target.value as 'charge' | 'payment_intent' })}><option value="payment_intent">PaymentIntent (pi_…)</option><option value="charge">Charge (ch_… or py_…)</option></select></label></div>
        <ColumnSelect label="Customer email column (optional)" table={orderTable} value={mapping.order.customerEmailColumn || ''} onChange={column => setOrder({ customerEmailColumn: column || undefined })} />
        <p className="cw-provider-note">Fills a missing case email from the reviewed order. Existing emails stay unchanged.</p>
        <p>Order fields to include, including both ID columns:</p><Columns table={orderTable} value={mapping.order.columns} onChange={columns => setOrder({ columns })} />
        {mapping.related.map((relation, index) => <fieldset className="cw-provider-scope" key={index}><legend>Related table {index + 1}</legend>
          <label className="cw-field"><span>Related table {index + 1}</span><select value={relation.table} onChange={e => setRelated(index, { table: e.target.value, orderColumn: '', columns: [] })}><option value="">Choose table</option>{tables.filter(t => t.name !== mapping.order.table && !mapping.related.some((r, i) => i !== index && r.table === t.name)).map(t => <option key={t.name}>{t.name}</option>)}</select></label>
          <label className="cw-field"><span>Evidence category {index + 1}</span><select value={relation.section} onChange={e => setRelated(index, { section: e.target.value as typeof relation.section })}>{['tickets', 'delivery', 'history', 'attendance', 'support', 'policy'].map(section => <option key={section}>{section}</option>)}</select></label>
          <ColumnSelect label={`Order link column ${index + 1}`} table={tables.find(t => t.name === relation.table)} value={relation.orderColumn} onChange={orderColumn => setRelated(index, { orderColumn })} />
          <p>Fields to include, including the order link:</p><Columns table={tables.find(t => t.name === relation.table)} value={relation.columns} onChange={columns => setRelated(index, { columns })} />
          <button className="cw-button" onClick={() => { setPreview(null); setMapping(v => ({ ...v, related: v.related.filter((_, i) => i !== index) })); }}>Remove related table {index + 1}</button>
        </fieldset>)}
        <div className="cw-actions"><button className="cw-button" disabled={mapping.related.length >= 3} onClick={() => { setPreview(null); setMapping(v => ({ ...v, related: [...v.related, { section: 'tickets', table: '', orderColumn: '', columns: [] }] })); }}>Add related table</button>
          <button className="cw-button primary" disabled={!mapping.order.idColumn || !mapping.order.paymentColumn || !mapping.order.columns.includes(mapping.order.idColumn) || !mapping.order.columns.includes(mapping.order.paymentColumn)} onClick={() => void run('mapping', async () => { const result = await api<{ mapping: OrderEvidenceMapping }>({ action: 'save_mapping', mapping, confirmed: true }); setSaved(v => ({ ...v, mapping: result.mapping })); setPreview(null); setNotice('Mapping saved. Choose an imported case to preview its linked records.'); })}>Save evidence mapping</button></div>
      </>}
    </fieldset>
    <fieldset className="cw-provider-scope" disabled={!!busy || !stripeReady || !supabaseReady || !saved.mapping || mappingChanged}><legend>3. Review and import linked records</legend>
      {!eligible.length && <p>Import a dispute from the connected Stripe account first, then return here.</p>}
      {mappingChanged && saved.mapping && <p>Save your mapping changes before previewing.</p>}
      <label className="cw-field"><span>Linked evidence case</span><select value={caseId} onChange={e => { setCaseId(e.target.value); setPreview(null); }}><option value="">Choose an imported case</option>{eligible.map(c => <option key={c.id} value={c.id}>{c.title} · {c.stripeDisputeId}</option>)}</select></label>
      <button className="cw-button" disabled={!caseId} onClick={() => void run('preview', async () => { setPreview(null); const result = await api<{ preview: LinkedEvidencePreview }>({ action: 'preview_records', caseId }); setPreview(result.preview); })}>Preview linked records</button>
      {preview && <div className="cw-evidence-preview"><p><strong>{preview.records.length} records</strong> for {preview.paymentRef}. Fetched {new Date(preview.fetchedAt).toLocaleString()}. Preview expires after ten minutes.</p>
        {preview.limitations.map((limitation, index) => <p className="cw-provider-note" key={index}>{limitation}</p>)}
        {preview.records.map(record => <details key={record.id} open><summary>{record.section}: {record.table}</summary><dl>{Object.entries(record.fields).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value === null ? 'null' : String(value)}</dd></div>)}</dl></details>)}
        <button className="cw-button primary" onClick={() => void run('import', async () => { const result = await api<{ caseId: string }>({ action: 'import_records', caseId, previewId: preview.id, confirmed: true }); await openCase(result.caseId); })}>Import reviewed records</button>
      </div>}
    </fieldset>
    {busy && <p role="status">{busy === 'loading' ? 'Loading evidence setup…' : 'Working…'}</p>}
  </article>;
}
