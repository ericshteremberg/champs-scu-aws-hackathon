"use client";

import { useEffect, useState } from 'react';
import { Database, Link2, LoaderCircle, ShieldCheck, Unplug } from 'lucide-react';
import type { ProviderStatus, SchemaTable, SupabaseConnection, SupabaseProject } from '../../lib/providers/types';
import './provider-connectors.css';
import { EvidenceCollector } from './evidence-collector';
import { ImapConnector } from './imap-provider';
import { GmailConnector } from './gmail-provider';
import type { WorkspaceState } from '../../lib/domain';
import { ProviderEvidence } from './provider-evidence';
import { StripeAccountConnector } from './stripe-provider';
import { ResendConnector } from './resend-provider';

const outcomes: Record<string, string> = {
  gmail_authorized: 'Gmail authorized. Choose a case and review messages before importing.',
  gmail_denied: 'Gmail authorization was canceled.',
  gmail_invalid_state: 'Gmail authorization expired or belongs to another browser. Start again here.',
  gmail_failed: 'Gmail authorization could not be completed. Check the Google app setup and test-user access, then try again.',
  authorized: 'Supabase authorized. Choose the project you want to connect.',
  denied: 'Authorization was canceled. You can connect when you are ready.',
  invalid_state: 'This authorization attempt expired or belongs to another browser. Start again here.',
  failed: 'Authorization could not be completed. Start again or contact the workspace operator.',
  stripe_authorized: 'Stripe authorized. Confirm the account shown below, then verify read access.',
  stripe_denied: 'Stripe authorization was canceled. You can connect when you are ready.',
  stripe_invalid_state: 'This Stripe authorization attempt expired or belongs to another browser. Start again here.',
  stripe_failed: 'Stripe authorization could not be completed. Start again. If Causality is already installed in Stripe, uninstall it before reconnecting.',
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || 'The connection could not be updated. Try again.');
  return value as T;
}

export function ProviderConnectors({ cases, onImported }: { cases: WorkspaceState['cases']; onImported: (state: WorkspaceState, caseId: string) => void }) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<SupabaseProject[]>([]);
  const [selected, setSelected] = useState('');
  const [schema, setSchema] = useState<SchemaTable[] | null>(null);
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connection = status?.supabase.connection;
  const authorized = connection?.status === 'authorized';

  useEffect(() => {
    let alive = true;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('provider_result');
    if (outcome && outcomes[outcome]) {
      url.searchParams.delete('provider_result');
      window.history.replaceState(window.history.state, '', url);
    }
    api<ProviderStatus>('/api/providers').then(value => { if (alive) { setStatus(value); setSelected(value.supabase.connection?.project?.ref || ''); } }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) { setBusy(''); if (outcome && outcomes[outcome]) setNotice(outcomes[outcome]); } });
    return () => { alive = false; };
  }, []);

  const saveConnection = (value: SupabaseConnection | null) => {
    setStatus(current => current ? { ...current, supabase: { ...current.supabase, connection: value } } : current);
  };
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The request failed.'); }
    finally { setBusy(''); }
  };
  const connect = () => run('connect', async () => {
    const result = await api<{ authorizationUrl: string }>('/api/providers/supabase/start', {});
    const url = new URL(result.authorizationUrl);
    if (url.origin !== 'https://api.supabase.com' || url.pathname !== '/v1/oauth/authorize') throw new Error('The provider authorization address is invalid.');
    window.location.assign(url.toString());
  });
  const loadProjects = () => run('projects', async () => {
    const result = await api<{ projects: SupabaseProject[] }>('/api/providers/supabase', { action: 'projects' });
    setProjects(result.projects);
    if (!result.projects.length) setNotice('No projects are available to this authorization. Check your Supabase organization access.');
  });
  const selectProject = () => run('select', async () => {
    const result = await api<{ connection: SupabaseConnection }>('/api/providers/supabase', { action: 'select_project', projectRef: selected });
    saveConnection(result.connection); setSchema(null); setTables([]);
    setNotice('Project selected. Review its table and column names next.');
  });
  const loadSchema = () => run('schema', async () => {
    const result = await api<{ schema: SchemaTable[] }>('/api/providers/supabase', { action: 'schema' });
    setSchema(result.schema); setTables(connection?.approvedTables || []);
    setNotice(result.schema.length ? 'Choose the tables and columns Causality may use for evidence. No customer rows were read.' : 'No supported tables were found in the public schema.');
  });
  const toggleColumn = (table: string, column: string) => setTables(current => {
    const existing = current.find(t => t.name === table)?.columns || [];
    const columns = existing.includes(column) ? existing.filter(c => c !== column) : [...existing, column];
    return [...current.filter(t => t.name !== table), ...(columns.length ? [{ name: table, columns }] : [])];
  });
  const approve = () => run('approve', async () => {
    const result = await api<{ connection: SupabaseConnection }>('/api/providers/supabase', { action: 'approve_tables', tables });
    saveConnection(result.connection); setSchema(null);
    setNotice('Evidence scope saved. Map these columns to a verified Stripe payment below.');
  });
  const disconnect = () => run('disconnect', async () => {
    const result = await api<{ connection: SupabaseConnection | null }>('/api/providers/supabase', { action: 'disconnect' });
    saveConnection(result.connection); setProjects([]); setSelected(''); setSchema(null); setTables([]); setConfirmDisconnect(false);
    setNotice(result.connection?.revocationPending ? 'Causality access is disabled. Supabase revocation could not be confirmed. Retry revocation or remove Causality in your Supabase organization’s Authorized apps.' : 'Supabase disconnected. Saved project and evidence scope were cleared.');
  });

  return <section className="cw-panel cw-provider-panel" aria-label="Business account connections">
    <div className="cw-provider-heading"><div><h2>Accounts</h2><p>Connect a source to import evidence.</p></div><ShieldCheck size={24} /></div>
    {error && <p className="cw-banner error" role="alert">{error}</p>}
    {notice && <p className="cw-banner neutral" role="status">{notice}</p>}
    <div className="cw-provider-grid">
      <EvidenceCollector cases={cases} />
      <article className="cw-provider-card" aria-label="Supabase account">
        <h3><Database size={20} />Supabase <span className={`cw-pill${authorized ? ' green' : ''}`}>{authorized ? 'Authorized' : connection?.status === 'reconnect_required' ? 'Reconnect required' : 'Not connected'}</span></h3>
        <p>Choose a project and review its tables.</p>
        <p className="cw-provider-note">Supabase grants database read access. Causality limits row queries to approved fields linked to a verified Stripe payment. Save your mapping below.</p>
        {!connection || connection.status === 'disconnected' ? <div className="cw-actions">
          {connection?.revocationPending ? <button className="cw-button" disabled={!!busy} onClick={() => void disconnect()}>Retry Supabase revocation</button> : <button className="cw-button primary" disabled={!!busy || !status?.supabase.configured} onClick={() => void connect()}>{busy === 'connect' ? <LoaderCircle size={16} /> : <Link2 size={16} />}{busy === 'loading' ? 'Loading…' : status?.supabase.configured ? 'Connect Supabase' : 'Setup unavailable'}</button>}
        </div> : <>
          {connection.project && <p>Selected project: <strong>{connection.project.name}</strong> <span className="cw-provider-note">({connection.project.organization})</span></p>}
          {authorized && <div className="cw-actions"><button className="cw-button" disabled={!!busy} onClick={() => void loadProjects()}>{projects.length ? 'Refresh projects' : connection.project ? 'Change project' : 'Choose project'}</button>{connection.project && <button className="cw-button" disabled={!!busy} onClick={() => void loadSchema()}>Review tables and columns</button>}</div>}
          {!!projects.length && authorized && <div className="cw-provider-project"><label className="cw-field"><span>Supabase project</span><select value={selected} disabled={!!busy} onChange={e => setSelected(e.target.value)}><option value="">Select a project</option>{projects.map(p => <option key={p.ref} value={p.ref}>{p.name} ({p.organization})</option>)}</select></label><button className="cw-button primary" disabled={!!busy || !selected} onClick={() => void selectProject()}>Use selected project</button></div>}
          {!!connection.approvedTables?.length && <p>Approved scope: {connection.approvedTables.length} tables, {connection.approvedTables.reduce((sum, t) => sum + t.columns.length, 0)} columns. Set up your evidence mapping below.</p>}
          {schema && schema.length > 0 && <fieldset className="cw-provider-scope" disabled={!!busy}><legend>Approved evidence columns, public schema</legend><p>Select evidence fields only. Exclude secrets, QR codes and unrelated personal data.</p>{schema.map(table => <details key={table.name}><summary>{table.name}</summary><div className="cw-provider-columns">{table.columns.map(column => <label key={column}><input type="checkbox" checked={tables.some(t => t.name === table.name && t.columns.includes(column))} onChange={() => toggleColumn(table.name, column)} />{column}</label>)}</div></details>)}<button className="cw-button primary" disabled={!tables.length} onClick={() => void approve()}>Save approved scope</button></fieldset>}
          {confirmDisconnect ? <div className="cw-provider-disconnect"><p>Stop Supabase access and clear the selected project and scope?</p><div className="cw-actions"><button className="cw-button" disabled={!!busy} onClick={() => setConfirmDisconnect(false)}>Keep connection</button><button className="cw-button danger" disabled={!!busy} onClick={() => void disconnect()}>Confirm disconnect Supabase</button></div></div> : <button className="cw-button" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}><Unplug size={16} />Disconnect Supabase</button>}
        </>}
      </article>
      <StripeAccountConnector status={status?.stripe} onChange={connection => setStatus(current => current ? { ...current, stripe: { ...current.stripe, connection } } : current)} />
      <GmailConnector status={status?.gmail} cases={cases} onImported={onImported} onChange={connection => setStatus(current => current ? { ...current, gmail: { configured: current.gmail?.configured || false, connection } } : current)} />
      <ResendConnector cases={cases} onImported={onImported} />
      <ImapConnector onScopeChanged={async () => { setStatus(await api<ProviderStatus>('/api/providers')); }} status={status?.imap} cases={cases} onImported={onImported} onChange={connection => setStatus(current => current ? { ...current, imap: { configured: current.imap?.configured || false, connection } } : current)} />
      {status && <ProviderEvidence key={`${status.supabase.connection?.updatedAt}:${status.stripe.connection?.updatedAt}`} status={status} cases={cases} onImported={onImported} />}
    </div>
  </section>;
}
