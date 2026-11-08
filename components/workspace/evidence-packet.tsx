"use client";

import type { DisputeCase } from '@/lib/domain';
import { formatMoney } from '@/lib/money';
import { packetNotes, packetResponse, packetSources, citationText } from '@/lib/report/packet';

export function EvidencePacket({ current, content = current.draft?.content ?? '' }: { current: DisputeCase; content?: string }) {
  const sources = packetSources(current);
  const notes = packetNotes(current);
  return (
    <article aria-label="Evidence packet preview" className="cw-report-document" style={{ padding: 'clamp(20px, 4vw, 48px)', borderTop: '4px solid #f58220', whiteSpace: 'normal' }}>
      <p className="cw-eyebrow">CAUSALITY / DISPUTE EVIDENCE</p>
      <h2 style={{ margin: '16px 0' }}>Evidence packet</h2>
      <p>{current.customerName} · {current.orderRef} · {formatMoney(current.amount, current.currency)}</p>
      <p className="cw-caption" style={{ margin: '12px 0 28px' }}>
        {current.source === 'demo' ? 'Synthetic sample' : current.draft?.status === 'approved' ? 'Reviewed copy' : 'Draft for review'} · {sources.length} saved source records · Not submitted
      </p>
      <h3>Merchant response</h3>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.75, marginTop: 16 }}>
        {packetResponse(current, content) || 'Prepare a response from the attached evidence to create your PDF.'}
      </div>
      <h3 style={{ marginTop: 32 }}>Included evidence</h3>
      <ol style={{ paddingLeft: 24, marginTop: 12 }}>
        {sources.map((record, i) => <li key={record.id} style={{ marginBottom: 10, overflowWrap: 'anywhere' }}><strong>[E{i + 1}]</strong> {record.title}</li>)}
      </ol>
      {notes.length > 0 && <details style={{ marginTop: 24 }}>
        <summary>Material limitations and review notes ({notes.length})</summary>
        <p className="cw-caption">These qualifications are included in the PDF.</p>
        <ul style={{ paddingLeft: 24 }}>{notes.map((note, i) => <li key={i} style={{ marginTop: 12 }}>{citationText(note, sources)}</li>)}</ul>
      </details>}
      <p className="cw-caption" style={{ marginTop: 28 }}>The PDF contains the response, source register, review notes and full saved source text. Original file attachments remain available in the case. Submissions are disabled.</p>
    </article>
  );
}
