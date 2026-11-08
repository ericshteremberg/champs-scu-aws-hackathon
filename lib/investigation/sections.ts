import type { Evidence } from '../domain.ts';
import { EVIDENCE_SECTIONS, type EvidenceSection } from './types.ts';

/** Routing only, never a determination that delivery, attendance or consent occurred. */
export function evidenceSections(record: Evidence): EvidenceSection[] {
  if (record.provenance && EVIDENCE_SECTIONS.includes(record.provenance.section as EvidenceSection)) {
    return [record.provenance.section as EvidenceSection];
  }
  const sections = new Set<EvidenceSection>();
  const text = `${record.title} ${record.content}`;
  if (record.source === 'stripe') sections.add('summary');
  if (record.source === 'gmail' || record.source === 'imap') sections.add('support');
  if (record.source === 'policy' || /\b(policy|policies|terms|nonrefundable|non-refundable|refund policy)\b/i.test(text)) sections.add('policy');
  if (/\b(order|purchase|booking|reservation)\b/i.test(text)) sections.add('order');
  if (/\b(tickets?|issued|issuance|handoff|pickup|pick-up)\b/i.test(text)) sections.add('tickets');
  if (/\b(delivery|delivered|dispatch|email|emails|sms|bounce|mailbox|confirmation|reminder)\b/i.test(text)) sections.add('delivery');
  if (/\b(recovery|resend|transfer|replacement|history|return)\b/i.test(text)) sections.add('history');
  if (/\b(scans?|scanned|admission|attendance|entry)\b/i.test(text)) sections.add('attendance');
  if (!sections.size) sections.add(record.source === 'database' ? 'order' : 'support');
  return [...sections];
}

/** Legacy bucket diagnostics are not evidence that a fact or record is absent. */
export function isCategoryDiagnostic(text: string): boolean {
  return /^(?:No (?:summary|order|tickets|delivery|support|history|attendance|policy) records are attached to this case\.|(?:Summary|Order|Tickets|Delivery|Support|History|Attendance|Policy) evidence is unavailable\.|No attached records (?:were|are) classified under |No records were returned from the (?:summary|order|tickets|delivery|support|history|attendance|policy) classification\.)/.test(text);
}

export function reviewNotes(notes: string[]): string[] {
  const seen = new Set<string>();
  return notes.filter(note => {
    const key = note.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key || isCategoryDiagnostic(note) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
