"use client";
import { useEffect, useState } from 'react';
type Status = { configured: boolean; verifiedAt: string | null; domains: string[] };
type Case = { id: string; customerName: string; orderRef: string; source: string; status: string; email: string };
type Preview = { content: string; emailId: string; orderRef: string };
type Candidate = { emailId: string; subject: string; createdAt?: string; source: string };
type Search = { candidates: Candidate[]; moreAvailable: boolean; nextCursor?: string; searchedEmail: string; orderRef: string; linkedTruncated?: boolean };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const value = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(value.error || 'Resend request failed.'); return value;
}
export function ResendConnector() {
  const [status,setStatus] = useState<Status | null>(null), [cases,setCases] = useState<Case[]>([]);
  const [caseId,setCaseId] = useState(''), [emailId,setEmailId] = useState(''), [preview,setPreview] = useState<Preview | null>(null), [search,setSearch] = useState<Search | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  useEffect(() => { let alive=true; api<Status>('/api/providers/resend').then(s=>{if(alive)setStatus(s);}).catch(e=>{if(alive)setError(e.message);}); return ()=>{alive=false;}; },[]);
  const run = async (action: ()=>Promise<void>) => {setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Request failed.');}finally{setBusy(false);}};
  const showPreview = async (id: string, selectedCase = caseId) => { setPreview(null); const r=await api<{preview:Preview}>('/api/providers/resend',{action:'preview',caseId:selectedCase,emailId:id});setEmailId(id);setPreview(r.preview); };
  const find = async (selectedCase: string, recent = false, after?: string) => {
    setPreview(null); setSearch(null); setEmailId('');
    const result = await api<Search>('/api/providers/resend', { action: 'find', caseId: selectedCase, ...(recent ? { recent: true } : {}), ...(after ? { after } : {}) });
    setSearch(result);
    setNotice(result.candidates.length ? `Found ${result.candidates.length} candidate emails for ${result.searchedEmail}. Recipient, sender and exact order are checked before preview.` : `No matching emails in this page for ${result.searchedEmail}.${result.moreAvailable ? ' Search older emails below.' : ' No more records were returned.'} This does not prove an email was never sent.`);
    if (result.candidates.length === 1 && result.candidates[0].source === 'case_reference') await showPreview(result.candidates[0].emailId, selectedCase);
  };
  return <article id="resend-connection" className="cw-provider-card" aria-label="Resend email evidence">
    <h3>Resend <span className={`cw-pill${status?.verifiedAt ? ' green' : ''}`}>{status?.verifiedAt?'Read access verified':status?.configured?'Configured':'Not configured'}</span></h3>
    <p>Choose a case to find its sent emails automatically. We use Resend references already linked to the case, including imported message-log records, then search sent-email metadata by recipient when needed.</p>
    <p className="cw-provider-note">Delivery means mail-server acceptance, not reading or attendance. No sending access is used.</p>
    {error && <p role="alert" className="cw-banner error">{error}</p>}{notice && <p role="status" className="cw-banner neutral">{notice}</p>}
    {status?.configured && <>
      <p className="cw-provider-note">Allowed senders: {status.domains.join(', ')}</p>
      <div className="cw-actions"><button className="cw-button" disabled={busy} onClick={()=>void run(async()=>{await api('/api/providers/resend',{action:'verify'});setStatus(await api<Status>('/api/providers/resend'));setNotice('Read access verified. No email was sent.');})}>Verify access</button><button className="cw-button" disabled={busy} onClick={()=>void run(async()=>{const s=await api<{cases:Case[]}>('/api/workspace');setCases(s.cases.filter(c=>c.source!=='demo' && ['needs_review','investigating','ready'].includes(c.status)));setCaseId('');setPreview(null);setSearch(null);setEmailId('');setNotice('Choose a case. Its email references and recipient are looked up automatically.');})}>Import email evidence</button></div>
      {!!cases.length && <div className="cw-provider-project">
        <label className="cw-field"><span>Resend evidence case</span><select value={caseId} disabled={busy} onChange={e=>{const id=e.target.value;setCaseId(id);setPreview(null);setSearch(null);setEmailId('');if(id)void run(()=>find(id));}}><option value="">Choose a case</option>{cases.map(c=><option key={c.id} value={c.id}>{c.customerName} · {c.orderRef}</option>)}</select></label>
        {search && <>
          <p>Recipient: <strong>{search.searchedEmail}</strong>. Order: {search.orderRef}.</p>
          {search.linkedTruncated && <p>Only the first 20 linked references are shown.</p>}
          <ul className="cw-gmail-results">{search.candidates.map(candidate=><li key={candidate.emailId}><div><strong>{candidate.subject || '(No subject)'}</strong><p>{candidate.source==='case_reference'?'Linked from case evidence':'Recipient match, order not yet verified'}{candidate.createdAt && ` · ${new Date(candidate.createdAt).toLocaleString()}`}</p></div><button className="cw-button" disabled={busy} onClick={()=>void run(()=>showPreview(candidate.emailId))}>Preview email <span className="sr-only">{candidate.emailId}</span></button></li>)}</ul>
          {search.moreAvailable && <button className="cw-button" disabled={busy} onClick={()=>void run(()=>find(caseId,true,search.nextCursor))}>Search older Resend emails</button>}
        </>}
        {!!caseId && <button className="cw-button" disabled={busy} onClick={()=>void run(()=>find(caseId,true))}>Search recent Resend emails</button>}
        <details><summary>Advanced: use a known Resend email ID</summary>
          <label className="cw-field"><span>Resend email ID</span><input value={emailId} disabled={busy} placeholder="Optional manual fallback" onChange={e=>{setEmailId(e.target.value.trim());setPreview(null);}}/></label>
          <button className="cw-button" disabled={busy||!caseId||!emailId} onClick={()=>void run(()=>showPreview(emailId))}>Preview matched record</button>
        </details>
      </div>}
      {busy && <p role="status">Finding and checking email records…</p>}
      {preview && <div><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',font:'inherit',lineHeight:1.6}}>{preview.content}</pre><button className="cw-button primary" disabled={busy} onClick={()=>void run(async()=>{await api('/api/providers/resend',{action:'import',caseId,emailId:preview.emailId,confirmed:true});setPreview(null);setNotice('Evidence saved to the case. Run the investigation again to include it.');})}>Attach to case</button></div>}
    </>}
  </article>;
}
