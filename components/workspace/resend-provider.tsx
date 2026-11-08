"use client";

import { useEffect, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import type { DisputeCase, WorkspaceState } from '../../lib/domain';
import './provider-connectors.css';

type Status = { configured: boolean; verifiedAt: string | null; domains: string[] };
type Preview = { content: string; emailId: string; orderRef: string; subject: string; lastEvent: string; eventCount: number };
type Props = {
  cases: DisputeCase[];
  caseId?: string;
  disabled?: boolean;
  designPreview?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onImported: (state: WorkspaceState, caseId: string) => void;
};
async function api<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/providers/resend', {
    method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  const value = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) throw new Error(response.status === 404
    ? 'Resend controls need the current AWS backend. Deploy the matching backend, then retry.'
    : value.code === 'aws_required' ? 'Resend requires the AWS-backed workspace. This local preview cannot read live emails.'
    : value.error || 'Could not reach Resend. Try again.');
  return value;
}
const validId = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function ResendConnector({ cases, caseId: fixedCaseId, disabled = false, designPreview = false, onBusyChange, onImported }: Props) {
  const [expanded, setExpanded] = useState(!fixedCaseId);
  const [status, setStatus] = useState<Status | null>(null);
  const [selectedCase, setSelectedCase] = useState(fixedCaseId || '');
  const [emailId, setEmailId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const caseId = fixedCaseId || selectedCase;
  const current = cases.find(c => c.id === caseId);
  const eligible = cases.filter(c => c.source !== 'demo' && !['investigating', 'submitting', 'submitted', 'won', 'lost'].includes(c.status));
  const sample = current?.source === 'demo' || designPreview;
  const locked = disabled || busy || loading;
  const imported = current?.evidence.filter(e => e.provenance?.fields.provider === 'Resend') || [];
  useEffect(() => {
    if (!expanded || sample) return;
    let alive = true;
    setLoading(true); setError('');
    api<Status>().then(s => { if (alive) setStatus(s); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [expanded, sample]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); } finally { setBusy(false); }
  };
  const refreshStatus = () => run(async () => setStatus(await api<Status>()));
  const reset = () => { setPreview(null); setNotice(''); setError(''); };
  return <article className={`cw-provider-card cw-resend${fixedCaseId ? ' cw-resend-inline' : ''}`} aria-label="Resend email evidence">
    <div className="cw-resend-heading">
      <div><h3><Mail size={18} aria-hidden="true" />Resend{imported.length > 0 && <span className="cw-pill green">{imported.length} linked</span>}</h3><p>Email delivery evidence for this report.</p></div>
      {fixedCaseId && <button className="cw-button" aria-expanded={expanded} disabled={busy} onClick={() => setExpanded(!expanded)}>{expanded ? 'Close' : 'Add email evidence'}</button>}
    </div>
    {expanded && <div className="cw-resend-body">
      {sample ? <p className="cw-provider-note">Live email imports are available on real cases. Sample evidence stays separate.</p> : <>
        {error && <p role="alert" className="cw-banner error">{error}</p>}
        {notice && <p role="status" className="cw-banner neutral">{notice}</p>}
        <div className="cw-resend-status"><span className="cw-pill">{loading ? 'Checking connection…' : !status ? 'Connection unavailable' : status.verifiedAt ? 'Read access verified' : status.configured ? 'Ready to verify' : 'Setup required'}</span>
          <button className="cw-button" disabled={locked} onClick={() => void (status?.configured ? run(async () => { await api({ action: 'verify' }); setStatus(await api<Status>()); setNotice('Read access verified.'); }) : refreshStatus())}><RefreshCw size={15} aria-hidden="true" />{status?.configured ? 'Verify access' : 'Retry connection'}</button>
        </div>
        {status && !status.configured && <p className="cw-provider-note">The workspace operator must configure the server-side Resend key and approved sender domains.</p>}
        {status?.configured && <>
          {disabled && <p className="cw-provider-note">Save any response edits and finish the current investigation before importing. Closed cases are read-only.</p>}
          <p className="cw-provider-note">Senders: {status.domains.join(', ') || 'No approved domains'}</p>
          {!fixedCaseId && <label className="cw-field"><span>Case</span><select value={selectedCase} disabled={locked} onChange={e => { setSelectedCase(e.target.value); setEmailId(''); reset(); }}><option value="">Choose a case</option>{eligible.map(c => <option key={c.id} value={c.id}>{c.customerName} · {c.orderRef || c.title}</option>)}</select></label>}
          {!fixedCaseId && !eligible.length && <p className="cw-provider-note">Create or import a real case to attach email evidence.</p>}
          <div className="cw-resend-input"><label className="cw-field"><span>Resend email ID</span><input value={emailId} disabled={locked || !current} placeholder="Paste the email UUID" autoComplete="off" spellCheck={false} onChange={e => { setEmailId(e.target.value.trim()); reset(); }} /></label>
            <button className="cw-button" disabled={locked || !current || !validId.test(emailId)} onClick={() => void run(async () => { setPreview(null); const r = await api<{ preview: Preview }>({ action: 'preview', caseId, emailId }); setPreview(r.preview); })}>{busy ? 'Checking…' : 'Preview email'}</button>
          </div>
          <p className="cw-provider-note">Use the ID from Resend or your order’s email log. The recipient, order and sender must match.</p>
          {preview && <section className="cw-resend-preview" aria-label="Matched Resend record"><div className="cw-resend-heading"><h4>{preview.subject}</h4><span className="cw-pill">{preview.lastEvent.replace(/^email\./, '').replaceAll('_', ' ')}</span></div>
            <p>Matched to {preview.orderRef} · {preview.eventCount} captured events</p>
            <details><summary>Inspect source record</summary><pre>{preview.content}</pre></details>
            <p className="cw-provider-note">Delivery confirms mail-server acceptance, not reading or attendance.</p>
            <button className="cw-button primary" disabled={locked} onClick={() => void run(async () => {
              await api({ action: 'import', caseId, emailId: preview.emailId, confirmed: true });
              setPreview(null); setNotice('Email attached. It will be included in the next compilation.');
              const response = await fetch('/api/workspace', { cache: 'no-store' });
              if (!response.ok) throw new Error('Email saved. Reload the workspace to see the updated evidence before compiling.');
              onImported(await response.json() as WorkspaceState, caseId);
            })}>{busy ? 'Attaching…' : 'Attach to report'}</button>
          </section>}
          {imported.length > 0 && <details className="cw-resend-linked"><summary>Linked Resend records ({imported.length})</summary>{imported.map(e => <div key={e.id}><span>{e.title}</span><button className="cw-button" disabled={locked} onClick={() => { setEmailId(String(e.provenance?.fields.emailId || '')); reset(); }}>Check latest status</button></div>)}</details>}
        </>}
      </>}
    </div>}
  </article>;
}
