"use client";

import type { DisputeCase } from '@/lib/domain';
import { visualEvidence } from '@/lib/report/exhibits';
import { formatMoney } from '@/lib/money';
import { packetNotes, packetResponse, packetSources, packetIncludedSources, citationText } from '@/lib/report/packet';

export function EvidencePacket({ current, content = current.draft?.content ?? '' }: { current: DisputeCase; content?: string }) {
  const sources = packetSources(current);
  const notes = packetNotes(current);
  const included = packetIncludedSources(current, content);
  const originals = visualEvidence(current);
  return (
    <article aria-label="Evidence packet preview" className="cw-report-document" style={{ padding: 'clamp(20px, 4vw, 48px)', borderTop: '4px solid #f58220', whiteSpace: 'normal' }}>
      <p className="cw-eyebrow">CAUSALITY / DISPUTE EVIDENCE</p>
      <h2 style={{ margin: '16px 0' }}>Evidence packet</h2>
      <p>{current.customerName} · {current.orderRef} · {formatMoney(current.amount, current.currency)}</p>
      <p className="cw-caption" style={{ margin: '12px 0 28px' }}>
        {current.source === 'demo' ? 'Synthetic sample' : current.draft?.status === 'approved' ? 'Reviewed copy' : 'Draft for review'} · {sources.length} saved source records · Not submitted
      </p>
      <div className="cw-banner neutral" style={{ marginBottom: 24 }}>
        <p>{originals.length
          ? `${originals.length} original file${originals.length === 1 ? '' : 's'} will appear as visual exhibits. The PDF includes all source records and original exhibits, with repeated material consolidated.`
          : 'Original evidence is missing. This export will be a text-only review draft. Use Collect original evidence to retrieve Stripe receipts, approved Supabase rows and available Resend bodies through your connected accounts. Unavailable originals are never recreated from summaries.'}</p>
      </div>
      {originals.length > 0 && <details style={{ marginBottom: 24 }}>
        <summary>Original files included in the PDF</summary>
        <ul>{originals.map(record => <li key={record.id}><a href={record.downloadUrl} target="_blank" rel="noreferrer">{record.fileName || record.title}</a> {record.capturedAt ? `Collected ${new Date(record.capturedAt).toLocaleDateString()}` : 'Collection time not recorded'}</li>)}</ul>
      </details>}
      <h3>Merchant response</h3>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.75, marginTop: 16 }}>
        {packetResponse(current, content) || 'Prepare a response from the attached evidence to create your PDF.'}
      </div>
      <h3 style={{ marginTop: 32 }}>Included evidence</h3>
      <ol style={{ paddingLeft: 24, marginTop: 12 }}>
        {included.map((record) => <li key={record.id} style={{ marginBottom: 10, overflowWrap: 'anywhere' }}><strong>[E{sources.findIndex(source => source.id === record.id) + 1}]</strong> {record.title}</li>)}
      </ol>
      {notes.length > 0 && <details style={{ marginTop: 24 }}>
        <summary>Internal review notes ({notes.length})</summary>
        <p className="cw-caption">These notes stay in the workspace. Material qualifications must be included beside the relevant claim in the saved response.</p>
        <ul style={{ paddingLeft: 24 }}>{notes.map((note, i) => <li key={i} style={{ marginTop: 12 }}>{citationText(note, sources)}</li>)}</ul>
      </details>}
      <p className="cw-caption" style={{ marginTop: 28 }}>The PDF includes original image and PDF exhibits where attached, with file fingerprints and source labels. Other file formats remain available in the case. A fingerprint detects byte changes; it does not authenticate what an image depicts. Submissions are disabled.</p>
    </article>
  );
}
