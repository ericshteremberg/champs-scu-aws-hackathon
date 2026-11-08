"use client";
import { useEffect, useState } from 'react';
type Status = { configured: boolean; verifiedAt: string | null; domains: string[] };
type Case = { id: string; customerName: string; orderRef: string; source: string };
type Preview = { content: string; emailId: string; orderRef: string };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const value = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(value.error || 'Resend request failed.'); return value;
}
export function ResendConnector() {
  const [status,setStatus] = useState<Status | null>(null), [cases,setCases] = useState<Case[]>([]);
  const [caseId,setCaseId] = useState(''), [emailId,setEmailId] = useState(''), [preview,setPreview] = useState<Preview | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  useEffect(() => { let alive=true; api<Status>('/api/providers/resend').then(s=>{if(alive)setStatus(s);}).catch(e=>{if(alive)setError(e.message);}); return ()=>{alive=false;}; },[]);
  const run = async (action: ()=>Promise<void>) => {setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Request failed.');}finally{setBusy(false);}};
  return <article className="cw-provider-card" aria-label="Resend email evidence">
    <h3>Resend <span className={`cw-pill${status?.verifiedAt ? ' green' : ''}`}>{status?.verifiedAt?'Read access verified':status?.configured?'Configured':'Not configured'}</span></h3>
    <p>Import a delivery record matched to the case’s recipient and order.</p>
    <p className="cw-provider-note">Delivery means mail-server acceptance, not reading or attendance. No sending access is used.</p>
    {error && <p role="alert" className="cw-banner error">{error}</p>}{notice && <p role="status" className="cw-banner neutral">{notice}</p>}
    {status?.configured && <>
      <p className="cw-provider-note">Allowed senders: {status.domains.join(', ')}</p>
      <div className="cw-actions"><button className="cw-button" disabled={busy} onClick={()=>void run(async()=>{await api('/api/providers/resend',{action:'verify'});setStatus(await api<Status>('/api/providers/resend'));setNotice('Read access verified. No email was sent.');})}>Verify access</button><button className="cw-button" disabled={busy} onClick={()=>void run(async()=>{const s=await api<{cases:Case[]}>('/api/workspace');setCases(s.cases.filter(c=>c.source!=='demo'));setNotice('Choose a case and paste its Resend email ID.');})}>Import email evidence</button></div>
      {!!cases.length && <div className="cw-provider-project">
        <label className="cw-field"><span>Resend evidence case</span><select value={caseId} disabled={busy} onChange={e=>{setCaseId(e.target.value);setPreview(null);}}><option value="">Choose a case</option>{cases.map(c=><option key={c.id} value={c.id}>{c.customerName} · {c.orderRef}</option>)}</select></label>
        <label className="cw-field"><span>Resend email ID</span><input value={emailId} disabled={busy} placeholder="Email UUID from Resend" onChange={e=>{setEmailId(e.target.value.trim());setPreview(null);}}/></label>
        <button className="cw-button" disabled={busy||!caseId||!emailId} onClick={()=>void run(async()=>{setPreview(null);const r=await api<{preview:Preview}>('/api/providers/resend',{action:'preview',caseId,emailId});setPreview(r.preview);})}>Preview matched record</button>
      </div>}
      {preview && <div><pre style={{whiteSpace:'pre-wrap',font:'inherit',lineHeight:1.6}}>{preview.content}</pre><button className="cw-button primary" disabled={busy} onClick={()=>void run(async()=>{await api('/api/providers/resend',{action:'import',caseId,emailId,confirmed:true});setPreview(null);setNotice('Evidence saved to the case. Run the investigation again to include it.');})}>Attach to case</button></div>}
    </>}
  </article>;
}
