"use client";
import { useEffect, useState } from 'react';
import type { DisputeCase } from '../../lib/domain';

export function StripeDraftWriter({ current, disabled }: { current: DisputeCase; disabled: boolean }) {
  const [enabled, setEnabled] = useState(false), [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true; setEnabled(false); setOpen(false); setAcknowledged(false); setNotice('');
    fetch('/api/stripe/status', {cache:'no-store'}).then(async response => {
      if (!response.ok) return;
      const status = await response.json() as { configured?: boolean; draftWritesEnabled?: boolean; integration?: { status?: string } };
      if (alive) setEnabled(status.configured === true && status.draftWritesEnabled === true && status.integration?.status === 'connected');
    }).catch(() => {});
    return () => { alive = false; };
  }, [current.id, current.draft?.revision]);
  const ready = enabled && !disabled && current.source === 'stripe' && current.status === 'ready' && current.draft?.status === 'approved' && !current.draft.sourceStale && !current.evidence.some(e => e.fileName || e.downloadUrl);
  return <section className="cw-panel cw-panel-body" aria-label="Save Stripe draft">
    <h3>Save a draft to Stripe</h3>
    <p>{enabled ? 'Saves approved text. Does not submit immediately.' : 'Requires Stripe write access.'}</p>
    {notice && <p role="status">{notice}</p>}
    <button className="cw-button" disabled={!ready || busy} onClick={() => { setOpen(true); setAcknowledged(false); }}>Review draft</button>
    {open && <div>
      <p>Revision {current.draft?.revision} · {current.stripeDisputeId}</p>
      <pre style={{whiteSpace:'pre-wrap',maxHeight:260,overflow:'auto',font:'inherit'}}>{current.draft?.content}</pre>
      <label style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:16}}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} /> I understand Stripe’s auto-response settings may submit this saved evidence at the deadline.</label>
      <div className="cw-actions" style={{marginTop:16}}>
        <button className="cw-button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button className="cw-button primary" disabled={!ready || !acknowledged || busy} onClick={async () => {
          setBusy(true); setNotice('');
          try {
            const response = await fetch('/api/stripe/draft', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId:current.id,draftRevision:current.draft?.revision,confirmed:true,autoSubmitAcknowledged:true})});
            const result = await response.json() as { error?: string };
            if (!response.ok) throw new Error(result.error || 'Could not confirm the Stripe draft.');
            setNotice('Saved to Stripe with submit=false. Stripe’s deadline auto-response settings still apply.'); setOpen(false);
          } catch(error) { setNotice(error instanceof Error ? error.message : 'Could not confirm the Stripe draft.'); }
          finally { setBusy(false); }
        }}>{busy ? 'Saving…' : 'Save approved draft to Stripe'}</button>
      </div>
    </div>}
  </section>;
}
