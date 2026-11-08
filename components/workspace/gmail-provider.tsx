"use client";

import { useState } from 'react';
import { Link2, Mail, Search, Unplug } from 'lucide-react';
import type { WorkspaceState } from '../../lib/domain';
import type { GmailConnection, GmailMessage, GmailPreview, ProviderStatus } from '../../lib/providers/types';

export function GmailConnector({ status, cases, onChange, onImported }: { status: ProviderStatus['gmail']; cases: WorkspaceState['cases']; onChange: (connection: GmailConnection | null) => void; onImported: (state: WorkspaceState, caseId: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [caseId, setCaseId] = useState(''), [messages, setMessages] = useState<GmailMessage[]>([]), [preview, setPreview] = useState<GmailPreview | null>(null);
  const [more, setMore] = useState(false), [confirm, setConfirm] = useState(false);
  const connection = status?.connection, authorized = connection?.status === 'authorized';
  const selected = cases.find(c => c.id === caseId);
  const run = async (action: string, id?: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const body = action === 'connect' ? {} : { action, ...(['search', 'preview', 'import'].includes(action) ? { caseId } : {}), ...(id ? { messageId: id } : {}), ...(action === 'import' ? { confirmed: true } : {}) };
      const response = await fetch(`/api/providers/gmail${action === 'connect' ? '/start' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
      const result = await response.json() as { error?: string; authorizationUrl?: string; connection?: GmailConnection | null; messages?: GmailMessage[]; moreAvailable?: boolean; preview?: GmailPreview };
      if (!response.ok) throw new Error(result.error || 'Gmail could not complete the request.');
      if (action === 'connect') {
        const url = new URL(result.authorizationUrl || '');
        if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Invalid Google authorization address.');
        window.location.assign(url.toString()); return;
      }
      if (action === 'disconnect') { onChange(result.connection || null); setMessages([]); setPreview(null); setConfirm(false); setNotice(result.connection?.revocationPending ? 'Gmail access stopped. Google revocation is pending. Retry revocation or remove Causality in your Google Account connections.' : 'Gmail disconnected. Previously imported evidence remains on its case.'); }
      if (action === 'search') { setMessages(result.messages || []); setPreview(null); setMore(!!result.moreAvailable); setNotice(result.messages?.length ? 'Check that the message concerns this dispute before importing.' : 'No matches. Add the message manually in the case.'); }
      if (action === 'preview') setPreview(result.preview || null);
      if (action === 'import') {
        setPreview(null); setMessages([]); setNotice('Email imported. Previous draft approval was cleared.');
        const refreshed = await fetch('/api/workspace', { cache: 'no-store' });
        if (!refreshed.ok) throw new Error('Email imported, but the case could not reload. Refresh the page.');
        onImported(await refreshed.json() as WorkspaceState, caseId);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'The Gmail request failed.'); }
    finally { setBusy(false); }
  };
  return <article className="cw-provider-card cw-gmail-card" aria-label="Gmail account authorization">
    <h3><Mail size={20} />Gmail <span className={`cw-pill${authorized ? ' green' : ''}`}>{authorized ? 'Authorized' : connection?.status === 'reconnect_required' ? 'Reconnect required' : 'Not connected'}</span></h3>
    <p>Find and import emails for a case.</p>
    <p className="cw-provider-note">Read-only mailbox access. Causality searches the case’s customer email and opens messages only on preview. No sending or deletion.</p>
    {error && <p className="cw-banner error" role="alert">{error}</p>}
    {notice && <p className="cw-banner neutral" role="status">{notice}</p>}
    {connection?.email && <p>Mailbox: <strong>{connection.email}</strong></p>}
    {!status?.configured && <p className="cw-provider-note">Google app setup is required before connecting.</p>}
    {(!connection || connection.status === 'disconnected') && <button className="cw-button primary" disabled={busy || !status?.configured} onClick={() => void run(connection?.revocationPending ? 'disconnect' : 'connect')}><Link2 size={16} />{connection?.revocationPending ? 'Retry Gmail revocation' : status?.configured ? 'Connect Gmail' : 'Gmail setup unavailable'}</button>}
    {authorized && <>
      <label className="cw-field"><span>Case for Gmail evidence</span><select value={caseId} disabled={busy} onChange={e => { setCaseId(e.target.value); setMessages([]); setPreview(null); setMore(false); setNotice(''); setError(''); }}><option value="">Choose a case</option>{cases.filter(c => ['needs_review', 'investigating', 'ready'].includes(c.status)).map(c => <option key={c.id} value={c.id}>{c.title} ({c.email})</option>)}</select></label>
      {selected && <p className="cw-provider-note">Search: mail from or to {selected.email}. Spam and Trash are excluded.</p>}
      <button className="cw-button" disabled={busy || !caseId} onClick={() => void run('search')}><Search size={16} />Find customer emails</button>
      {more && <p className="cw-provider-note">Showing up to 10 matches. Add older messages manually.</p>}
      {messages.length > 0 && <ul className="cw-gmail-results">{messages.map(m => <li key={m.id}><div><strong>{m.subject || '(No subject)'}</strong><p>{m.from}<br />{new Date(m.occurredAt).toLocaleString()}</p></div><button className="cw-button" disabled={busy} onClick={() => void run('preview', m.id)}>Preview email <span className="sr-only">{m.subject}</span></button></li>)}</ul>}
      {preview && <section className="cw-gmail-preview" aria-label="Gmail message preview"><h4>{preview.subject || '(No subject)'}</h4><p>From: {preview.from}<br />To: {preview.to}<br />{new Date(preview.occurredAt).toLocaleString()}</p><pre>{preview.text}</pre><p className="cw-provider-note">Plain text only. Attachments and HTML are excluded.{preview.truncated && ' This is an excerpt truncated at 20,000 characters.'} Preview text is temporarily stored in AWS with a ten-minute expiry; automatic deletion can take longer. Imported evidence is retained with the case.</p><p>Confirm that this email is relevant to <strong>{selected?.title}</strong>. Importing clears any previous draft approval.</p><button className="cw-button primary" disabled={busy} onClick={() => void run('import', preview.id)}>Import reviewed email</button></section>}
    </>}
    {connection && connection.status !== 'disconnected' && (confirm ? <div className="cw-provider-disconnect"><p>Stop Gmail reads and revoke Google authorization? Imported case evidence will remain.</p><div className="cw-actions"><button className="cw-button" disabled={busy} onClick={() => setConfirm(false)}>Keep Gmail connection</button><button className="cw-button danger" disabled={busy} onClick={() => void run('disconnect')}>Confirm disconnect Gmail</button></div></div> : <button className="cw-button" disabled={busy} onClick={() => setConfirm(true)}><Unplug size={16} />Disconnect Gmail</button>)}
    <p className="cw-provider-note"><a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Manage Google Account connections</a></p>
  </article>;
}
