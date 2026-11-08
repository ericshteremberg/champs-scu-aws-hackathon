"use client";

import { useState, type FormEvent } from 'react';
import { Mail, Search, Unplug } from 'lucide-react';
import type { WorkspaceState } from '../../lib/domain';
import type { ImapConnection, ImapMessage, ImapPreview, ProviderStatus } from '../../lib/providers/types';

export function ImapConnector({ status, cases, onChange, onImported }: { status: ProviderStatus['imap']; cases: WorkspaceState['cases']; onChange: (connection: ImapConnection | null) => void; onImported: (state: WorkspaceState, caseId: string) => void }) {
  const [setup, setSetup] = useState(false), [email, setEmail] = useState(''), [host, setHost] = useState(''), [password, setPassword] = useState(''), [sentFolder, setSentFolder] = useState(''), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [caseId, setCaseId] = useState(''), [messages, setMessages] = useState<ImapMessage[]>([]), [preview, setPreview] = useState<ImapPreview | null>(null), [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connection = status?.connection, authorized = connection?.status === 'authorized';
  const selected = cases.find(c => c.id === caseId);
  async function request(body: unknown) {
    const response = await fetch('/api/providers/imap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const result = await response.json() as { error?: string; connection?: ImapConnection; messages?: ImapMessage[]; preview?: ImapPreview; moreAvailable?: boolean; scanLimited?: boolean };
    if (!response.ok) throw new Error(result.error || 'The mailbox request could not be completed.');
    return result;
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!consent) return;
    setBusy(true); setError(''); setNotice('');
    const settings = { email: email.trim(), host: host.trim(), password, folders: ['INBOX', ...(sentFolder.trim() ? [sentFolder.trim()] : [])] };
    setPassword('');
    try {
      const result = await request({ action: 'connect', settings, confirmed: true });
      onChange(result.connection || null); setSetup(false); setConsent(false); setNotice('Mailbox connected. Choose a case to find relevant emails.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed.'); }
    finally { settings.password = ''; setBusy(false); }
  }
  async function run(action: 'search' | 'preview' | 'import' | 'disconnect', messageId?: string) {
    setBusy(true); setError(''); setNotice('');
    if (action === 'search') { setPreview(null); setMessages([]); }
    try {
      const result = await request({ action, ...(action === 'disconnect' ? {} : { caseId }), ...(messageId ? { messageId } : {}), ...(action === 'import' ? { confirmed: true } : {}) });
      if (action === 'disconnect') { onChange(result.connection || null); setPreview(null); setMessages([]); setConfirmDisconnect(false); setNotice('Saved login removed. Revoke an app password with your provider separately. Imported evidence remains on its case.'); }
      if (action === 'search') { setMessages(result.messages || []); setNotice(`${result.messages?.length ? 'Review messages before importing. Matching an email address alone does not prove relevance.' : 'No matching emails found in the searched folders.'}${result.scanLimited ? ' Search covered only the newest 500 messages per selected folder.' : ''}${result.moreAvailable ? ' More matches may exist; up to ten are shown.' : ''}`); }
      if (action === 'preview') setPreview(result.preview || null);
      if (action === 'import') {
        setPreview(null); setMessages([]); setNotice('Reviewed email imported. Prior draft approval was cleared.');
        const refreshed = await fetch('/api/workspace', { cache: 'no-store' });
        if (!refreshed.ok) throw new Error('Email imported, but the case could not reload. Refresh the page.');
        onImported(await refreshed.json() as WorkspaceState, caseId);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'The mailbox request failed.'); }
    finally { setBusy(false); }
  }
  return <article className="cw-provider-card cw-imap-card" aria-label="Other email IMAP connection">
    <h3><Mail size={20} />Other email provider <span className="cw-provider-note">IMAP</span></h3>
    <p>Connect Network Solutions or another provider that supports IMAP over TLS. For Google mail, use Connect Gmail. Microsoft 365 OAuth is not supported here.</p>
    {error && <p role="alert" className="cw-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {connection?.email && <p><strong>{connection.email}</strong><br />{connection.host}<br />Folders: {connection.folders?.join(', ')}</p>}
    {connection?.status === 'reconnect_required' && <p role="status">This login needs attention. Disconnect, then reconnect with current credentials.</p>}
    {(!connection || connection.status === 'disconnected') && (!setup ? <button className="cw-button primary" disabled={!status?.configured || busy} onClick={() => setSetup(true)}>Connect other email</button> : <form onSubmit={connect} className="cw-imap-form">
      <label className="cw-field"><span>Mailbox email</span><input type="email" autoComplete="username" required maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} placeholder="support@yourbusiness.com" /></label>
      <label className="cw-field"><span>Incoming IMAP server</span><input type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={253} value={host} disabled={busy} onChange={e => setHost(e.target.value)} placeholder="imap.yourprovider.com" /></label>
      <p className="cw-provider-note">Use your provider&apos;s exact server hostname. Port 993 with verified TLS is required. <a href="https://www.networksolutions.com/help/article/how-do-i-get-started-with-pop3-and-imap" target="_blank" rel="noopener noreferrer">Find Network Solutions settings</a>.</p>
      <label className="cw-field"><span>Mailbox or app password</span><input type="password" autoComplete="off" required maxLength={1024} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
      <label className="cw-field"><span>Sent folder name (optional)</span><input autoComplete="off" maxLength={150} value={sentFolder} disabled={busy} onChange={e => setSentFolder(e.target.value)} placeholder="Exact name, for example Sent" /></label>
      <p className="cw-provider-note">INBOX is included. Add the exact Sent folder name to search replies too. Searches check the newest 500 messages per folder and show up to ten matches.</p>
      <p className="cw-provider-note">Your login is stored privately in AWS with encryption at rest. Causality opens folders read-only and does not send, delete or mark mail as read. The credential itself may permit broader access. Use an app password when your provider supports one. This team preview shares connections with everyone using the team login.</p>
      <label className="cw-imap-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />I authorize Causality to store this login and read the selected mailbox folders.</label>
      <div className="cw-actions"><button className="cw-button primary" disabled={busy || !consent}>{busy ? 'Checking mailbox…' : 'Test and connect mailbox'}</button><button type="button" className="cw-button" disabled={busy} onClick={() => { setSetup(false); setPassword(''); setConsent(false); }}>Cancel setup</button></div>
    </form>)}
    {authorized && <>
      <label className="cw-field"><span>Case for IMAP evidence</span><select disabled={busy} value={caseId} onChange={e => { setCaseId(e.target.value); setMessages([]); setPreview(null); setNotice(''); setError(''); }}><option value="">Choose a case</option>{cases.filter(c => ['needs_review', 'investigating', 'ready'].includes(c.status)).map(c => <option value={c.id} key={c.id}>{c.title} ({c.email})</option>)}</select></label>
      {selected && <p className="cw-provider-note">Search: mail from or to {selected.email} in {connection.folders?.join(', ')}.</p>}
      <button className="cw-button" disabled={busy || !caseId} onClick={() => void run('search')}><Search size={16} />Find customer emails via IMAP</button>
      {!!messages.length && <ul className="cw-gmail-results">{messages.map(m => <li key={m.id}><div><strong>{m.subject || '(No subject)'}</strong><p>{m.from}<br />{m.folder} · {new Date(m.occurredAt).toLocaleString()}</p></div><button className="cw-button" disabled={busy} onClick={() => { setPreview(null); void run('preview', m.id); }}>Preview email <span className="sr-only">{m.subject}</span></button></li>)}</ul>}
      {preview && <section className="cw-gmail-preview" aria-label="IMAP message preview"><h4>{preview.subject || '(No subject)'}</h4><p>From: {preview.from}<br />To: {preview.to}<br />Folder: {preview.folder}</p><pre>{preview.text}</pre><p className="cw-provider-note">Plain text only. HTML and attachments are excluded.{preview.truncated && ' Excerpt truncated to 20,000 characters.'} The preview expires after ten minutes; AWS deletion may take longer. Imported evidence is retained with the case.</p><p>Confirm this email is relevant to <strong>{selected?.title}</strong>. Importing clears previous draft approval.</p><button className="cw-button primary" disabled={busy} onClick={() => void run('import', preview.id)}>Import reviewed IMAP email</button></section>}
    </>}
    {connection && connection.status !== 'disconnected' && (confirmDisconnect ? <div className="cw-provider-disconnect"><p>Remove the saved login and stop IMAP reads? Imported evidence remains.</p><div className="cw-actions"><button className="cw-button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Keep IMAP connection</button><button className="cw-button danger" disabled={busy} onClick={() => void run('disconnect')}>Confirm disconnect IMAP</button></div></div> : <button className="cw-button" disabled={busy} onClick={() => setConfirmDisconnect(true)}><Unplug size={16} />Disconnect IMAP</button>)}
  </article>;
}
