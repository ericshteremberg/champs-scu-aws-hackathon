"use client";
import { useState } from 'react';
import { formatMoney } from '../../lib/money';
import type { WorkspaceState } from '../../lib/domain';
import type { CustomerMatch, ImapMessage, LinkedEvidencePreview, OrderEvidenceMapping } from '../../lib/providers/types';

type Provider = 'Stripe' | 'Supabase' | 'Resend' | 'IMAP' | 'Policies';
type Item = { id: string; title: string; subtitle: string };
type Outcome = { state: 'running' | 'ready' | 'attention'; summary: string; details?: { label: string; value: string }[]; items?: Item[] };
const providers: Provider[] = ['Stripe', 'Supabase', 'Resend', 'IMAP', 'Policies'];
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'This provider could not complete the lookup.');
  return data;
}
export function EvidenceCollector({ cases, onImported }: { cases: WorkspaceState['cases']; onImported: (state: WorkspaceState, caseId: string, stayOnPage?: boolean) => void }) {
  const [caseId, setCaseId] = useState(''), [busy, setBusy] = useState(false), [results, setResults] = useState<Partial<Record<Provider, Outcome>>>({});
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null), [error, setError] = useState('');
  const selected = cases.find(c => c.id === caseId);
  const collect = async () => {
    if (!selected || busy) return;
    setBusy(true); setPreview(null); setError('');
    setResults(Object.fromEntries(providers.map(p => [p, { state: 'running', summary: 'Looking up this case…' }])));
    const work = async (provider: Provider): Promise<Outcome> => {
      if (provider === 'Stripe') {
        const result = await api<{ payment: { disputeId: string; chargeId: string; amount: number; currency: string; status: string }; limitation: string }>('/api/providers/evidence', { action: 'preview_case_payment', caseId });
        return { state: 'ready', summary: 'Payment verified.', details: [{ label: 'Dispute', value: result.payment.disputeId }, { label: 'Charge', value: result.payment.chargeId }, { label: 'Amount', value: formatMoney(result.payment.amount, result.payment.currency) }, { label: 'Status', value: result.payment.status }, { label: 'Limits', value: result.limitation }] };
      }
      if (provider === 'Supabase') {
        const status = await api<{ mapping: OrderEvidenceMapping | null; eligibleCaseIds: string[] }>('/api/providers/evidence');
        if (status.mapping && status.eligibleCaseIds.includes(caseId)) {
          const result = await api<{ preview: LinkedEvidencePreview }>('/api/providers/evidence', { action: 'preview_records', caseId });
          return { state: 'ready', summary: `${result.preview.records.length} order-linked records found.`, details: [...result.preview.records.flatMap(record => Object.entries(record.fields).map(([label, value]) => ({ label: `${record.table}: ${label}`, value: String(value ?? '') }))), ...result.preview.limitations.map(value => ({ label: 'Limits', value }))] };
        }
        const matches = await api<{ matches: CustomerMatch[]; moreAvailable: boolean }>('/api/providers/evidence', { action: 'customer_lookup', caseId, query: selected.email || selected.customerName });
        const sameEmail = !!selected.email && !matches.moreAvailable && matches.matches.length === 1 && matches.matches[0].email.toLowerCase() === selected.email.toLowerCase();
        return { state: sameEmail ? 'ready' : 'attention', summary: sameEmail ? 'Customer matched. Map the payment to retrieve orders.' : matches.matches.length ? 'Possible matches. Review the customer before using an email.' : 'No match. Check the customer lookup settings.', details: matches.matches.map(m => ({ label: m.name, value: m.email })) };
      }
      if (provider === 'Resend') {
        const result = await api<{ candidates: { emailId: string; subject: string; source: string }[]; moreAvailable: boolean }>('/api/providers/resend', { action: 'find', caseId });
        if (result.candidates.length === 1 && result.candidates[0].source === 'case_reference') {
          const verified = await api<{ preview: { content: string; subject: string; savedEvidence?: boolean; notice?: string } }>('/api/providers/resend', { action: 'preview', caseId, emailId: result.candidates[0].emailId });
          return { state: 'ready', summary: verified.preview.savedEvidence ? 'Saved evidence available. Live record not reverified.' : 'Linked email verified.', details: [{ label: verified.preview.savedEvidence ? 'Already attached evidence, not live verification' : verified.preview.subject || 'Resend record', value: [verified.preview.notice, verified.preview.content].filter(Boolean).join('\n\n') }] };
        }
        return { state: result.candidates.length ? 'ready' : 'attention', summary: `${result.candidates.length} candidates. Preview to verify the order.${result.moreAvailable ? ' More available in Resend.' : ''}`, items: result.candidates.map(m => ({ id: m.emailId, title: m.subject || '(No subject)', subtitle: 'Preview to check the exact order and recipient.' })) };
      }
      if (!selected.email) return { state: 'attention', summary: 'Add the customer’s email to search the mailbox.' };
      const result = await api<{ messages: ImapMessage[]; searchedEmail: string; moreAvailable: boolean; folders: string[] }>('/api/providers/imap', { action: 'search', caseId, scope: 'all' });
      return { state: result.messages.length ? 'ready' : 'attention', summary: `${result.messages.length} matches in ${result.folders.join(', ')}.${result.moreAvailable ? ' First ten shown.' : ''}${!result.messages.length ? ' Sent emails may not have a mailbox copy.' : ''}`, items: result.messages.map(m => ({ id: m.id, title: m.subject || '(No subject)', subtitle: `${m.folder} · ${m.from} → ${m.to}` })) };
    };
    // Each source reports its own result. A disconnected provider never hides the others.
    await Promise.allSettled(providers.filter(p => p !== 'Policies').map(async provider => {
      try { const result = await work(provider); setResults(current => ({ ...current, [provider]: result })); }
      catch (e) { setResults(current => ({ ...current, [provider]: { state: 'attention', summary: e instanceof Error ? e.message : 'This lookup failed.' } })); }
    }));
    // Case-changing imports are sequential. Independent failures remain visible.
    const details: { label: string; value: string }[] = []; let failed = false;
    for (const stage of ['records', 'gmail', 'imap', 'match']) {
      try {
        const result = await api<{ state?: WorkspaceState; captured: number; refreshedRecords?: number; notices?: string[]; notice?: string; related?: { title: string; reference: string }[] }>('/api/policies/collect', { caseId, stage });
        if (result.state) onImported(result.state, caseId, true);
        details.push({ label: stage === 'records' ? 'Approved records and policy versions' : stage, value: `${result.captured + (result.refreshedRecords || 0)} records attached. ${[...(result.notices || []), result.notice].filter(Boolean).join(' ')}` });
        if (stage === 'match') details.push(...(result.related || []).map(r => ({ label: r.title, value: r.reference })));
      } catch (e) { failed = true; details.push({ label: stage, value: e instanceof Error ? e.message : 'Collection failed.' }); }
    }
    // Refresh after mailbox imports too, even if the final policy match was unavailable.
    try { const state = await api<WorkspaceState>('/api/workspace'); onImported(state, caseId, true); } catch { /* next workspace refresh retains persisted evidence */ }
    setResults(current => ({ ...current, Policies: { state: failed ? 'attention' : 'ready', summary: 'Checked dated policies, checkout records and order-linked refund or cancellation correspondence. A match does not prove acceptance.', details } }));
    setBusy(false);
  };
  const openPreview = async (provider: Provider, id: string) => {
    setBusy(true); setError(''); setPreview(null);
    try {
      if (provider === 'IMAP') { const result = await api<{ preview: { subject: string; text: string } }>('/api/providers/imap', { action: 'preview', caseId, messageId: id }); setPreview({ title: result.preview.subject, text: result.preview.text }); }
      else { const result = await api<{ preview: { subject: string; content: string; savedEvidence?: boolean; notice?: string } }>('/api/providers/resend', { action: 'preview', caseId, emailId: id }); setPreview({ title: result.preview.savedEvidence ? 'Saved case evidence, not reverified' : result.preview.subject, text: [result.preview.notice, result.preview.content].filter(Boolean).join('\n\n') }); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Preview unavailable.'); }
    finally { setBusy(false); }
  };
  return <article className="cw-provider-card cw-imap-card" aria-label="Get evidence from all providers">
    <h3>Get evidence</h3>
    <p>Look up one case across connected providers. Automatically attach matched policy versions, approved database originals and exact-order policy correspondence from Gmail or IMAP. Review other provider matches below.</p>
    <label className="cw-field"><span>Case to collect evidence for</span><select value={caseId} disabled={busy} onChange={e => { setCaseId(e.target.value); setResults({}); setPreview(null); setError(''); }}><option value="">Choose a case</option>{cases.filter(c => c.source !== 'demo' && ['needs_review','investigating','ready'].includes(c.status)).map(c => <option key={c.id} value={c.id}>{c.customerName} · {c.orderRef || c.title}</option>)}</select></label>
    <button className="cw-button primary" disabled={busy || !caseId} onClick={() => void collect()}>{busy ? 'Getting evidence…' : 'Get evidence'}</button>
    <p className="cw-provider-note">Uses the case’s saved email and references. Missing setup, ambiguous customer matches and provider failures are shown separately. Policy collection attaches evidence and requires a fresh report afterward. Nothing is sent or submitted.</p>
    {error && <p role="alert">{error}</p>}
    <div aria-live="polite">{providers.map(provider => { const result = results[provider]; return result && <section key={provider} aria-label={`${provider} collection result`} className="cw-provider-scope"><h4>{provider}: {result.state === 'running' ? 'Running' : result.state === 'ready' ? 'Ready to review' : 'Needs attention'}</h4><p>{result.summary}</p>{result.details && <details><summary>Review {provider} records</summary><dl>{result.details.map((d,i) => <div key={i}><dt>{d.label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginLeft: 0 }}>{d.value}</dd></div>)}</dl></details>}{!!result.items?.length && <ul className="cw-gmail-results">{result.items.map(item => <li key={item.id}><div><strong>{item.title}</strong><p>{item.subtitle}</p></div><button className="cw-button" disabled={busy} onClick={() => void openPreview(provider,item.id)}>Preview {provider} email <span className="sr-only">{item.id}</span></button></li>)}</ul>}</section>; })}</div>
    {preview && <section aria-label="Collected email preview"><h4>{preview.title}</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>{preview.text}</pre><p>Attach this message from its source below.</p></section>}
  </article>;
}
