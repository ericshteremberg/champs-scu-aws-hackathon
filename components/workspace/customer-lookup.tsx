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
    <h4>Find customer email</h4>
    <p className="cw-provider-note">Search Supabase by name or email. Review matches before selecting.</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || disabled} style={{ border: 0, padding: 0, minWidth: 0 }}>
      {!config ? <button className="cw-button" onClick={() => void run(async () => { const value = await api<Configuration>({ action: 'customer_config' }); setConfig(value); setMapping(value.mapping || suggest(value.tables)); setEditing(!value.mapping); })}>Find customer account in Supabase</button> : <>
        <p>Project: {config.projectName}</p>
        {editing ? <>
          <label className="cw-field"><span>Customer lookup table</span><select value={mapping.table} onChange={e => { setMapping({ ...blank(), table: e.target.value }); setApproved(false); }}><option value="">Choose customer or order table</option>{config.tables.map(t => <option key={t.name}>{t.name}</option>)}</select></label>
          {table && (['idColumn', 'nameColumn', 'emailColumn'] as const).map((field, index) => <label className="cw-field" key={field}><span>{['Customer record ID column', 'Customer name column', 'Customer email column'][index]}</span><select value={mapping[field]} onChange={e => { setMapping(m => ({ ...m, [field]: e.target.value })); setApproved(false); }}><option value="">Choose column</option>{table.columns.map(c => <option key={c}>{c}</option>)}</select></label>)}
          <p className="cw-provider-note">Read-only access to these three columns. Changed permissions may require remapping orders.</p>
          <label className="cw-imap-consent"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I approve read-only customer lookup using these ID, name and email columns.</label>
          <button className="cw-button" disabled={!approved || !mapping.idColumn || !mapping.nameColumn || !mapping.emailColumn || new Set([mapping.idColumn, mapping.nameColumn, mapping.emailColumn]).size !== 3} onClick={() => void run(async () => { const value = await api<{ mapping: CustomerLookupMapping }>({ action: 'customer_save_mapping', mapping, confirmed: true }); setConfig(c => c ? { ...c, mapping: value.mapping } : c); setEditing(false); setResults(null); await onMappingSaved?.(); })}>Save customer lookup</button>
        </> : <>
          <label className="cw-field"><span>Customer name or email in Supabase</span><input value={query} maxLength={100} onChange={e => { setQuery(e.target.value); setResults(null); }} /></label>
          <p className="cw-provider-note">Up to five matches from {config.mapping?.table}.</p>
          <div className="cw-actions"><button className="cw-button" disabled={query.trim().length < 3} onClick={() => void run(async () => { setResults(null); setResults(await api<Results>({ action: 'customer_lookup', caseId, query })); })}>Look up customer</button><button className="cw-button" onClick={() => { setEditing(true); setApproved(false); setResults(null); }}>Change lookup columns</button></div>
        </>}
        {results && <div>
          <p role="status">{results.matches.length ? 'Select a match to update the case email and search the mailbox.' : 'No match. Try a shorter name.'}{results.moreAvailable ? ' More matches exist. Narrow your search.' : ''}{results.skippedInvalid ? ' Incomplete records omitted.' : ''}</p>
          <p className="cw-provider-note">Current: {currentEmail || 'No email'}. Changing it clears report approval.</p>
          <ul className="cw-gmail-results">{results.matches.map(match => <li key={match.id}><div><strong>{match.name}</strong><p>{match.email}</p></div><button className="cw-button" onClick={() => void run(async () => { const value = await api<{ email: string }>({ action: 'customer_select', caseId, lookupId: results.lookupId, matchId: match.id, confirmed: true }); setResults(null); await onResolved(value.email); })}>Use this email and search <span className="sr-only">{match.email} record {match.sourceId}</span></button></li>)}</ul>
        </div>}
      </>}
      {busy && <p role="status">Looking up customer details…</p>}
    </fieldset>
  </section>;
}
