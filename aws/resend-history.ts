import type { Evidence } from '../lib/domain.ts';

// Only server-imported, reviewed rows from the order's message log qualify.
// Never infer delivery from an email ID or from a merchant's `sent` status.
export function savedEmailLog(record: Evidence, orderRef: string) {
  const p = record.provenance, f = p?.fields;
  if (p?.sourceMode !== 'supabase_oauth' || p.section !== 'delivery' ||
      !/^supabase:[^:]+:public\.message_log:/.test(record.reference || '') ||
      f?.channel !== 'email' || !orderRef || String(f.order_id) !== orderRef) return null;
  const id = typeof f.provider_id === 'string' ? f.provider_id : '';
  const emailId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) ? id : null;
  return { evidenceId: record.id, emailId, subject: String(f.subject || f.kind || 'Order email'),
    logStatus: typeof f.status === 'string' ? f.status : 'unknown',
    occurredAt: typeof f.created_at === 'string' ? f.created_at : null };
}
export const savedEmailLimitations = [
  'The order email log is retained evidence, independent of Resend API retention.',
  'Recorded as sent means the merchant log reports sending; it does not confirm recipient-server delivery, reading, or attendance.',
  'A missing provider record does not mean the message was not sent. Missing email body or provider events remain unavailable.',
];
export function withSavedEmailContext(record: Evidence, orderRef: string): Evidence {
  const log = savedEmailLog(record, orderRef);
  if (!log || !record.provenance) return record;
  return { ...record, content: `${record.content || ''}\nMerchant email log status: ${log.logStatus}.\n${savedEmailLimitations.join('\n')}`,
    provenance: { ...record.provenance, fields: { ...record.provenance.fields, merchantEmailStatus: log.logStatus,
      // Keep failure counterevidence, but never upgrade merchant `delivered` to provider confirmation.
      providerStatus: ['failed', 'bounced', 'undelivered'].includes(log.logStatus) ? log.logStatus : null,
      statusSource: 'merchant_email_log' }, limitations: [...record.provenance.limitations, ...savedEmailLimitations] } };
}
