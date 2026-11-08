"use client";
import { useState, type FormEvent } from 'react';
import type { Policy } from '../../lib/domain';
async function api(body: unknown) {
  const response = await fetch('/api/policies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json() as { error?: string; uploadId: string; uploadUrl: string; fields: Record<string, string> }; if (!response.ok) throw new Error(data.error || 'Policy could not be saved.'); return data;
}
export function PolicyEditor({ policies, onSaved }: { policies: Policy[]; onSaved: () => Promise<void> }) {
  const [source, setSource] = useState('text'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    const form = new FormData(event.currentTarget), value = (key: string) => String(form.get(key) || '').trim();
    const metadata = { name: value('name'), kind: value('kind'), effectiveDate: value('effectiveDate'), ...Object.fromEntries(['endsAt','versionLabel','previousVersionId'].filter(k => value(k)).map(k => [k, value(k)])) };
    try {
      if (source === 'file') {
        const file = form.get('file'); if (!(file instanceof File) || !file.size) throw new Error('Choose a PDF or text document.');
        if (file.size > 10 * 1024 * 1024) throw new Error('The document must be 10 MB or smaller.');
        const upload = await api({ action: 'prepare-upload', metadata, fileName: file.name, mimeType: file.type || (file.name.endsWith('.txt') ? 'text/plain' : 'application/pdf'), size: file.size });
        const data = new FormData(); for (const [k,v] of Object.entries(upload.fields)) data.append(k, String(v)); data.append('file', file);
        const sent = await fetch(upload.uploadUrl, { method: 'POST', body: data }); if (!sent.ok) throw new Error('The original document upload failed. Retry the upload.');
        await api({ action: 'finalize-upload', uploadId: upload.uploadId });
      } else await api({ action: 'save', metadata, sourceType: source, ...(source === 'url' ? { url: value('url') } : { text: value('text') }) });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Policy could not be saved.'); } finally { setBusy(false); }
  };
  return <form className="cw-form" onSubmit={save}>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'grid', gap: 16 }}>
      <label className="cw-field"><span>Policy name</span><input name="name" required minLength={2} maxLength={160} placeholder="Event refund policy" /></label>
      <label className="cw-field"><span>Policy type</span><select name="kind"><option value="terms">Terms</option><option value="refund">Refund policy</option><option value="cancellation">Cancellation policy</option></select></label>
      <label className="cw-field"><span>Version of an existing policy (optional)</span><select name="previousVersionId"><option value="">New policy</option>{policies.map(p => <option key={p.id} value={p.id}>{p.name} · {p.versionLabel || p.version || 'legacy'}</option>)}</select></label>
      <label className="cw-field"><span>Version label (optional)</span><input name="versionLabel" maxLength={100} placeholder="November 2026" /></label>
      <label className="cw-field"><span>Declared effective date</span><input name="effectiveDate" type="date" required /></label>
      <label className="cw-field"><span>Effective until (optional, exclusive)</span><input name="endsAt" type="date" /></label>
      <label className="cw-field"><span>Policy source</span><select value={source} onChange={e => setSource(e.target.value)}><option value="text">Paste text</option><option value="url">Public URL</option><option value="file">Upload document</option></select></label>
      {source === 'text' && <label className="cw-field"><span>Policy text</span><textarea name="text" required minLength={10} maxLength={24000} rows={8} /></label>}
      {source === 'url' && <label className="cw-field"><span>Public HTTPS URL</span><input name="url" type="url" required maxLength={2048} placeholder="https://example.com/refund-policy" /></label>}
      {source === 'file' && <label className="cw-field"><span>Original document (PDF or UTF-8 text, up to 10 MB)</span><input name="file" type="file" accept=".pdf,.txt" required /></label>}
    </fieldset>
    <p className="cw-caption">We retain this version with its collection time. The effective date is your declaration. Saving a policy does not prove it was displayed or accepted at checkout. A current URL is captured as it exists now.</p>
    {error && <p role="alert">{error}</p>}
    <button className="cw-button primary" type="submit" disabled={busy}>{busy ? 'Saving original and version…' : 'Save policy version'}</button>
  </form>;
}
