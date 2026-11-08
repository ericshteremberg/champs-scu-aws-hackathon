import { z } from 'zod';
import type { CaseRecord, EvidenceEnvelope, Finding, InvestigationReport, InvestigationRun } from '../shared/types.js';
import { HttpError } from './errors.js';

export const reportInputSchema = z.object({
  summary: z.string().min(1).max(6000), assessment: z.enum(['supported', 'mixed', 'insufficient']),
  recommendation: z.string().min(1).max(4000),
  findings: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(240), detail: z.string().min(1).max(4000), stance: z.enum(['supports_merchant', 'supports_customer', 'neutral', 'unknown']), evidenceIds: z.array(z.string().min(1).max(160)).min(1).max(30) })).max(30),
  gaps: z.array(z.string().min(1).max(2000)).max(300), responseDraft: z.string().min(1).max(20000),
}).strict();

export type ReportInput = z.infer<typeof reportInputSchema>;

export function reportEvidenceIds(report: Pick<ReportInput, 'findings' | 'responseDraft'>): string[] {
  return [...new Set([...report.findings.flatMap(finding => finding.evidenceIds), ...[...report.responseDraft.matchAll(/\[([^\]\n]{1,160})\]/g)].map(match => match[1])])];
}

export function validateReport(input: unknown, evidence: EvidenceEnvelope[]): ReportInput {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, 'The response draft did not match the required report format.', 'INVALID_REPORT');
  const ids = new Set(evidence.flatMap(section => section.records.map(record => record.id)));
  const value = parsed.data;
  if (new Set(value.findings.map(item => item.id)).size !== value.findings.length) throw new HttpError(422, 'The report contains duplicate finding IDs.', 'INVALID_REPORT');
  for (const finding of value.findings) {
    if (finding.evidenceIds.some(id => !ids.has(id))) throw new HttpError(422, 'A finding cites evidence that was not retrieved for this case.', 'INVALID_CITATION');
  }
  const citations = [...value.responseDraft.matchAll(/\[([^\]\n]{1,160})\]/g)].map(match => match[1]);
  if (citations.some(id => !ids.has(id))) throw new HttpError(422, 'The response draft cites evidence that was not retrieved for this case.', 'INVALID_CITATION');
  if (ids.size && citations.length === 0) throw new HttpError(422, 'Include evidence citations in the response draft.', 'MISSING_CITATIONS');
  if (ids.size === 0 && value.assessment !== 'insufficient') throw new HttpError(422, 'A case with no available source records must be marked insufficient.', 'INVALID_ASSESSMENT');
  value.gaps = [...new Set([...value.gaps, ...evidence.flatMap(section => section.limitations), ...evidence.filter(section => section.status === 'unavailable').map(section => `${section.section[0].toUpperCase()}${section.section.slice(1)} evidence is unavailable.`)])];
  return value;
}

export function buildDemoReport(item: CaseRecord, evidence: EvidenceEnvelope[]): ReportInput {
  const records = evidence.flatMap(section => section.records);
  const acknowledged = records.find(record => record.fields.customerAcknowledgedReceipt === true);
  const delivery = evidence.find(section => section.section === 'delivery');
  const failed = delivery?.records.filter(record => ['bounced', 'undelivered', 'failed'].includes(String(record.fields.providerStatus))) ?? [];
  const delivered = delivery?.records.filter(record => record.fields.providerStatus === 'delivered') ?? [];
  const assessment = acknowledged ? 'supported' : failed.length > 0 ? 'mixed' : 'insufficient';
  const summary = acknowledged
    ? 'The retrieved support conversation includes a customer acknowledgement of receipt. Review that message alongside the payment, ticket, and delivery records.'
    : failed.length > 0
      ? 'The evidence includes failed delivery attempts. Payment and ticket issuance alone do not establish that the customer received the tickets.'
      : 'The available records do not establish that the customer received the tickets. Further delivery or correspondence evidence is needed.';
  const findings: Finding[] = records.slice(0, 20).map((record, index) => ({
    id: `finding_${index + 1}`, title: record.title, detail: record.detail,
    stance: record.fields.customerAcknowledgedReceipt === true ? 'supports_merchant'
      : ['bounced', 'undelivered', 'failed'].includes(String(record.fields.providerStatus)) ? 'supports_customer'
        : record.fields.providerStatus === 'delivered' ? 'supports_merchant' : 'neutral',
    evidenceIds: [record.id],
  }));
  const gaps = [...new Set(evidence.flatMap(section => section.limitations))];
  if (delivered.length) gaps.push('A provider delivery status does not establish that the message was read by the cardholder.');
  const lines = records.slice(0, 12).map(record => `${record.detail} [${record.id}]`);
  return {
    summary, assessment,
    recommendation: acknowledged ? 'Review the customer acknowledgement and its link to this order, then use the supported facts to prepare your response.'
      : failed.length ? 'Review the delivery failures and the customer conversation before deciding how to resolve the complaint. Confirm the current dispute and refund state with the payment provider.'
        : 'Request a matched support conversation or additional delivery records before making a delivery claim.',
    findings, gaps,
    responseDraft: `Re: ${item.reason}\nOrder reference: ${item.orderRef}\n\nThe following records were reviewed for this transaction:\n\n${lines.join('\n\n')}\n\nEvidence limitations:\n${gaps.map(gap => `- ${gap}`).join('\n') || '- No additional limitations were reported by the connected sources.'}\n\n${acknowledged ? `The customer acknowledgement above is relevant to the claim of nonreceipt. It should be reviewed in the context of the complete conversation. [${acknowledged.id}]` : 'These records do not independently establish receipt by the cardholder. Additional evidence is needed before asserting successful delivery.'}`,
  };
}

export function finalizeReport(input: unknown, run: InvestigationRun): InvestigationReport {
  const value = validateReport(input, run.evidence);
  return { ...value, caseId: run.caseId, runId: run.id, generatedAt: new Date().toISOString(),
    evidenceIds: reportEvidenceIds(value),
    metrics: { durationMs: Date.now() - Date.parse(run.startedAt), toolCalls: run.events.filter(event => event.type === 'tool_completed').length, recordCount: run.evidence.reduce((sum, section) => sum + section.records.length, 0) } };
}

export function exportMarkdown(item: CaseRecord, run: InvestigationRun): string {
  const report = run.report!;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(item.amount / 100);
  return [
    `# Casework evidence packet`, '', `Case: ${item.id}`, `Merchant: ${item.merchantName}`, `Amount: ${money}`, `Source: ${item.sourceMode}`, `Investigation: ${run.mode}`, `Reviewed: ${report.reviewedAt}`, '',
    '## Reviewed response', '', report.responseDraft, '', '## Findings', '', ...report.findings.map(finding => `- **${finding.title}**: ${finding.detail} (${finding.evidenceIds.join(', ')})`), '',
    '## Missing information and limitations', '', ...report.gaps.map(gap => `- ${gap}`), '',
    '## Source records', '', ...run.evidence.flatMap(section => section.records.map(record => `### ${record.id}\n\n${record.title}\n\n${record.detail}\n\nSource: ${record.source} / ${record.sourceId}\nOccurred: ${record.occurredAt}\nRetrieved: ${section.fetchedAt}\n\n\`\`\`json\n${JSON.stringify(record.fields, null, 2)}\n\`\`\`\n`)),
    '', '## Review note', '', report.reviewerNote || 'No additional note.', '',
  ].join('\n');
}
