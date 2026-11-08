"use client";
import { useState } from 'react';
import type { CustomerLookupMapping, CustomerMatch, SchemaTable } from '../../lib/providers/types';

type Configuration = { projectName: string; tables: SchemaTable[]; mapping: CustomerLookupMapping | null };
type Results = { lookupId: string; matches: CustomerMatch[]; moreAvailable: boolean; skippedInvalid: number; table: string };
async function api<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/providers/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'Customer lookup failed.');
  return result;
}
const blank = (): CustomerLookupMapping => ({ table: '', idColumn: '', nameColumn: '', emailColumn: '' });
function suggest(tables: SchemaTable[]): CustomerLookupMapping {
  for (const name of ['customers', 'orders', 'profiles', 'users']) {
    const table = tables.find(t => t.name === name);
    const nameColumn = ['name', 'full_name', 'display_name'].find(c => table?.columns.includes(c));
    if (table?.columns.includes('id') && table.columns.includes('email') && nameColumn) return { table: name, idColumn: 'id', nameColumn, emailColumn: 'email' };
  }
  return blank();
}
export function CustomerLookup({ caseId, customerName, currentEmail, disabled, onResolved, onBusyChange, onMappingSaved }: { caseId: string; customerName: string; currentEmail: string; disabled: boolean; onResolved: (email: string) => Promise<void>; onBusyChange: (busy: boolean) => void; onMappingSaved?: () => Promise<void> }) {
  const [config, setConfig] = useState<Configuration | null>(null), [mapping, setMapping] = useState(blank), [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(customerName || currentEmail), [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [approved, setApproved] = useState(false);
  const table = config?.tables.find(t => t.name === mapping.table);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); onBusyChange(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Customer lookup failed.'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <section aria-label="Supabase customer email lookup" className="cw-provider-scope">
    <h4>Find the customer’s email in Supabase</h4>
    <p className="cw-provider-note">Find a customer or order by name, then choose the matching email before searching the mailbox. A name match alone does not verify identity.</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || disabled} style={{ border: 0, padding: 0, minWidth: 0 }}>
      {!config ? <button className="cw-button" onClick={() => void run(async () => { const value = await api<Configuration>({ action: 'customer_config' }); setConfig(value); setMapping(value.mapping || suggest(value.tables)); setEditing(!value.mapping); })}>Find customer account in Supabase</button> : <>
        <p>Project: {config.projectName}</p>
        {editing ? <>
          <label className="cw-field"><span>Customer lookup table</span><select value={mapping.table} onChange={e => { setMapping({ ...blank(), table: e.target.value }); setApproved(false); }}><option value="">Choose customer or order table</option>{config.tables.map(t => <option key={t.name}>{t.name}</option>)}</select></label>
          {table && (['idColumn', 'nameColumn', 'emailColumn'] as const).map((field, index) => <label className="cw-field" key={field}><span>{['Customer record ID column', 'Customer name column', 'Customer email column'][index]}</span><select value={mapping[field]} onChange={e => { setMapping(m => ({ ...m, [field]: e.target.value })); setApproved(false); }}><option value="">Choose column</option>{table.columns.map(c => <option key={c}>{c}</option>)}</select></label>)}
          <p className="cw-provider-note">Set up once for this project. Only these three columns are read for customer lookup. Adding permissions can require saving your existing order-evidence mapping again.</p>
          <label className="cw-imap-consent"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I approve read-only customer lookup using these ID, name and email columns.</label>
          <button className="cw-button" disabled={!approved || !mapping.idColumn || !mapping.nameColumn || !mapping.emailColumn || new Set([mapping.idColumn, mapping.nameColumn, mapping.emailColumn]).size !== 3} onClick={() => void run(async () => { const value = await api<{ mapping: CustomerLookupMapping }>({ action: 'customer_save_mapping', mapping, confirmed: true }); setConfig(c => c ? { ...c, mapping: value.mapping } : c); setEditing(false); setResults(null); await onMappingSaved?.(); })}>Save customer lookup</button>
        </> : <>
          <label className="cw-field"><span>Customer name or email in Supabase</span><input value={query} maxLength={100} onChange={e => { setQuery(e.target.value); setResults(null); }} /></label>
          <p className="cw-provider-note">Try a first name or part of an email if the full name is spelled differently. Up to five records are shown from {config.mapping?.table}.</p>
          <div className="cw-actions"><button className="cw-button" disabled={query.trim().length < 3} onClick={() => void run(async () => { setResults(null); setResults(await api<Results>({ action: 'customer_lookup', caseId, query })); })}>Look up customer</button><button className="cw-button" onClick={() => { setEditing(true); setApproved(false); setResults(null); }}>Change lookup columns</button></div>
        </>}
        {results && <div>
          <p role="status">{results.matches.length ? 'Choose the correct account. Selecting it updates the case email and searches IMAP.' : 'No usable customer email matched. Try a shorter name or check the selected table.'}{results.moreAvailable ? ' More records exist. Narrow the search to find the right account.' : ''}{results.skippedInvalid ? ' Some records had missing or invalid customer details.' : ''}</p>
          <p className="cw-provider-note">Current case email: {currentEmail || 'Missing'}. Changing the case clears any prior draft approval. Matches expire after ten minutes.</p>
          <ul className="cw-gmail-results">{results.matches.map(match => <li key={match.id}><div><strong>{match.name}</strong><p>{match.email}<br />Record: {match.sourceId}</p></div><button className="cw-button" onClick={() => void run(async () => { const value = await api<{ email: string }>({ action: 'customer_select', caseId, lookupId: results.lookupId, matchId: match.id, confirmed: true }); setResults(null); await onResolved(value.email); })}>Use this email and search <span className="sr-only">{match.email} record {match.sourceId}</span></button></li>)}</ul>
        </div>}
      </>}
      {busy && <p role="status">Looking up customer details…</p>}
    </fieldset>
  </section>;
}
