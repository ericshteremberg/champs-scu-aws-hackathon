import { z } from 'zod';
import { formatMoney } from '../money.ts';
import { InvestigationError, type EvidenceEnvelope, type InvestigationInput, type InvestigationResult } from './types.ts';

export const reportSchema = z.object({
  content: z.string().min(1).max(50000), summary: z.string().min(1).max(6000),
  assessment: z.enum(['supported', 'mixed', 'insufficient']), recommendation: z.string().min(1).max(4000),
  findings: z.array(z.object({ kind: z.enum(['supported', 'conflict', 'missing']), title: z.string().min(1).max(240), detail: z.string().min(1).max(6000), evidenceIds: z.array(z.string().min(1).max(240)).max(100) })).max(30),
  gaps: z.array(z.string().min(1).max(3000)).max(300),
}).strict();
export type Report = z.infer<typeof reportSchema>;
const citationPattern = /(?<!\\)\[([^\]\n]{1,240})\]/g;
const quoteSource = (text: string) => text.replaceAll('[', '\\[').replaceAll(']', '\\]');

export function reportEvidenceIds(report: Pick<Report, 'content' | 'findings'>): string[] {
  return [...new Set([...report.findings.flatMap(finding => finding.evidenceIds), ...[...report.content.matchAll(citationPattern)].map(match => match[1])])];
}

export function validateReport(input: unknown, evidence: EvidenceEnvelope[]): Report & { evidenceIds: string[] } {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) throw new InvestigationError('invalid_report', 'The investigation did not produce the required report format.');
  const report = parsed.data;
  const ids = new Set(evidence.flatMap(section => section.records.map(record => record.id)));
  const cited = reportEvidenceIds(report);
  if (cited.some(id => !ids.has(id))) throw new InvestigationError('invalid_citation', 'The report cites records that were not retrieved for this case.');
  if (report.findings.some(finding => finding.kind !== 'missing' && !finding.evidenceIds.length)) throw new InvestigationError('missing_citation', 'Each supported finding or conflict must cite its source records.');
  if (ids.size && ![...report.content.matchAll(citationPattern)].length) throw new InvestigationError('missing_citation', 'The response must cite its retrieved evidence.');
  if (!ids.size && report.assessment !== 'insufficient') throw new InvestigationError('invalid_assessment', 'An investigation without source records must be marked insufficient.');
  const gaps = [...new Set([...report.gaps, ...evidence.flatMap(section => section.limitations), ...evidence.filter(section => section.status === 'unavailable').map(section => `${section.section[0].toUpperCase()}${section.section.slice(1)} evidence is unavailable.`)])];
  return { ...report, gaps, evidenceIds: cited };
}

export function buildSampleReport(item: InvestigationInput['case'], evidence: EvidenceEnvelope[]): Report {
  const records = evidence.flatMap(section => section.records);
  const acknowledgement = records.find(record => record.fields.customerAcknowledgedReceipt === true);
  const failed = evidence.find(section => section.section === 'delivery')?.records.some(record => ['bounced', 'undelivered', 'failed'].includes(String(record.fields.providerStatus)));
  const summary = acknowledgement
    ? 'The retrieved records include an explicit customer acknowledgement of receipt. Verify its relationship to this order before deciding how to respond.'
    : failed ? 'The records include failed delivery attempts. Payment and ticket issuance do not establish that the customer received the tickets.'
      : 'These attached records need merchant review. The sample investigation does not independently verify receipt or predict the dispute outcome.';
  const gaps = [...new Set(evidence.flatMap(section => section.limitations))];
  if (records.some(record => record.fields.providerStatus === 'delivered')) gaps.push('A provider delivery status does not establish that a message was read by the cardholder.');
  const findings: Report['findings'] = records.slice(0, 20).map(record => ({
    kind: ['bounced', 'undelivered', 'failed'].includes(String(record.fields.providerStatus)) ? 'conflict' : 'supported',
    title: record.title, detail: record.detail.length > 5800 ? `${record.detail.slice(0,5800)}\nExcerpt only. The full source remains available in the case.` : record.detail, evidenceIds: [record.id],
  }));
  const lines = [...records].sort((a,b) => a.occurredAt.localeCompare(b.occurredAt)).slice(0, 30).map(record => `${record.occurredAt} | ${quoteSource(record.title)}\n${quoteSource(record.detail.slice(0,900))}${record.detail.length > 900 ? '\nExcerpt only. Review the complete source in the case.' : ''}\nSource: ${quoteSource(record.source)} / ${quoteSource(record.sourceId)} [${record.id}]`);
  if (records.length > 30) gaps.push(`This sample draft includes excerpts from 30 of ${records.length} retrieved records. Review the remaining records in the case.`);
  return {
    content: ['MERCHANT REVIEW DRAFT', quoteSource(item.title), `Order: ${quoteSource(item.orderRef) || 'Not provided'} | Amount: ${formatMoney(item.amount, item.currency)}`, `Claim: ${quoteSource(item.reason)}`, 'This sample investigation is assembled from the retrieved records using explicit rules. It was not analyzed by a language model.', 'SOURCE TIMELINE', ...lines, 'Review each statement and its source before approval. This draft has not been submitted to the payment provider.'].join('\n\n'),
    findings, summary, assessment: acknowledgement ? 'supported' : failed ? 'mixed' : 'insufficient',
    recommendation: acknowledgement ? 'Review the acknowledgement and the original conversation, then use only supported facts in the response.' : 'Review the source records and obtain any missing delivery or correspondence evidence before asserting receipt.',
    gaps,
  };
}

export function completeReport(input: unknown, evidence: EvidenceEnvelope[], metrics: InvestigationResult['metrics'], modelId?: string): InvestigationResult {
  const report = validateReport(input, evidence);
  const limitations = report.gaps.length ? `\n\nSOURCE LIMITATIONS\n${report.gaps.map(gap => `- ${quoteSource(gap)}`).join('\n')}` : '';
  const content = `${report.content}${limitations}`;
  if (content.length > 50000) throw new InvestigationError('invalid_report', 'The report and source limitations exceed the 50,000-character draft limit. Produce a shorter report.');
  return { ...report, content, metrics, ...(modelId ? { modelId } : {}) };
}
