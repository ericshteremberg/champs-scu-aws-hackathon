import { z } from 'zod';
import { formatMoney } from '../money.ts';
import { EVIDENCE_SECTIONS, InvestigationError, type EvidenceEnvelope, type EvidenceSection, type InvestigationInput, type InvestigationResult } from './types.ts';

export type VerifiedFact = {
  id: string; section: EvidenceSection; title: string; text: string; evidenceIds: string[];
  basis: 'structured_fields' | 'attributed_excerpt';
  role: 'context' | 'acknowledged_access' | 'delivery_failure';
  fieldPaths: string[];
  packetUse: 'affirmative' | 'context' | 'excluded';
};
export type FactInventory = {
  version: 1; caseId: string; appealPolicy: 'challenge_all';
  assessment: InvestigationResult['assessment']; summary: string; recommendation: string;
  facts: VerifiedFact[]; gaps: string[]; packetFactIds: string[]; synthetic: boolean;
  coverage: { section: EvidenceSection; status: EvidenceEnvelope['status']; evidenceIds: string[]; sourceLimitations: string[] }[];
};
export const presentationSchema = z.object({
  sections: z.array(z.object({ section: z.enum(EVIDENCE_SECTIONS), factIds: z.array(z.string().regex(/^F[1-9]\d*$/)).min(1).max(180) }).strict()).max(8),
}).strict();
export type PresentationPlan = z.infer<typeof presentationSchema>;
export const SECTION_NAMES: Record<EvidenceSection, string> = {
  summary: 'Payment and case records', order: 'Order records', tickets: 'Ticket records', delivery: 'Delivery records',
  history: 'Order history', support: 'Customer and support records', attendance: 'Attendance records', policy: 'Policy records',
};
const literal = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replaceAll('[', '\\[').replaceAll(']', '\\]');
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const money = (amount: unknown, currency: unknown) => integer(amount) && typeof currency === 'string' && /^[a-z]{3}$/i.test(currency) ? formatMoney(amount, currency) : null;
const cite = (ids: string[]) => ids.map(id => `[${id}]`).join(' ');

/** Verified means derived from selected source fields, not independent proof of real-world truth. */
export function buildFactInventory(item: InvestigationInput['case'], evidence: EvidenceEnvelope[]): FactInventory {
  if (evidence.length !== EVIDENCE_SECTIONS.length || EVIDENCE_SECTIONS.some(section => !evidence.some(source => source.section === section)) || evidence.some(section => section.caseId !== item.id)) {
    throw new InvestigationError('incomplete_inventory', 'Read all eight authorized evidence sections before building the fact inventory.');
  }
  const ids = evidence.flatMap(section => section.records.map(record => record.id));
  if (new Set(ids).size !== ids.length) throw new InvestigationError('duplicate_evidence', 'Source IDs must be unique across the case.');
  const facts: VerifiedFact[] = [];
  const gaps: string[] = [];
  const coverage = EVIDENCE_SECTIONS.map(section => {
    const source = evidence.find(envelope => envelope.section === section)!;
    if (source.status === 'unavailable') gaps.push(`${SECTION_NAMES[section]} are unavailable in the selected evidence. Absence does not establish that the underlying event did or did not occur.`);
    else if (source.status === 'partial') gaps.push(`${SECTION_NAMES[section]} are partial; source-specific limitations are retained in the evidence inventory.`);
    for (const record of [...source.records].sort((a, b) => a.id.localeCompare(b.id))) {
      const fields = record.fields;
      if (typeof fields.orderRef === 'string' && fields.orderRef !== item.orderRef) throw new InvestigationError('evidence_scope_mismatch', 'A record contains another order reference. Reconfirm the case mapping.');
      const before = facts.length;
      const add = (text: string, fieldPaths: string[], role: VerifiedFact['role'] = 'context', packetUse: VerifiedFact['packetUse'] = 'context') => facts.push({
        id: `F${facts.length + 1}`, section, title: record.title, text,
        evidenceIds: [record.id], basis: 'structured_fields', fieldPaths, role, packetUse,
      });
      const amount = money(fields.amount, fields.currency);
      if (section === 'summary' && fields.chargeCaptured === true) add(amount ? `The payment record reports a captured payment of ${amount}.` : 'The payment record reports that the charge was captured.', ['chargeCaptured', ...(amount ? ['amount', 'currency'] : [])]);
      if (section === 'summary' && integer(fields.paymentMinorUnits)) {
        const value = money(fields.paymentMinorUnits, item.currency);
        if (value) add(`The mapped payment record reports an amount of ${value}; capture status is not inferred from the amount.`, ['paymentMinorUnits']);
      }
      if (section === 'order' && integer(fields.quantity)) add(`The order record lists a quantity of ${fields.quantity}. This does not establish ticket issuance or delivery.`, ['quantity']);
      if (section === 'order' && typeof fields.status === 'string') add(`The order status is recorded as "${literal(fields.status)}"; this is a source status, not proof of delivery.`, ['status'], 'context', fields.status === 'paid' ? 'context' : 'excluded');
      if (section === 'order' && typeof fields.eventStartsAt === 'string') {
        const date = new Date(fields.eventStartsAt);
        if (Number.isNaN(date.getTime())) gaps.push('An event timestamp is invalid and was not used.');
        else {
          try {
            const zone = typeof fields.eventTimezone === 'string' && fields.eventTimezone ? fields.eventTimezone : 'UTC';
            const formatted = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
            add(`The recorded event start is ${formatted} (${literal(zone)}).`, ['eventStartsAt', ...(zone !== 'UTC' ? ['eventTimezone'] : [])]);
          } catch { gaps.push('The event time zone is invalid; no local event date was asserted.'); }
        }
      }
      if (section === 'tickets') {
        const status = typeof fields.ticketStatus === 'string' ? fields.ticketStatus : typeof fields.status === 'string' ? fields.status : null;
        if (status) add(`This ticket's status is recorded as "${literal(status)}". A ticket record does not establish receipt, attendance or cardholder identity.`, [typeof fields.ticketStatus === 'string' ? 'ticketStatus' : 'status'], 'context', ['issued', 'valid', 'active'].includes(status) ? 'context' : 'excluded');
      }
      if (section === 'delivery') {
        const status = typeof fields.providerStatus === 'string' ? fields.providerStatus : typeof fields.state === 'string' ? fields.state : null;
        const channel = fields.channel === 'email' ? 'email' : fields.channel === 'sms' ? 'SMS' : 'delivery/queue';
        if (status) {
          const providerEvent = typeof fields.providerStatus === 'string' && ['email', 'sms'].includes(String(fields.channel));
          const failed = providerEvent && ['bounced', 'undelivered', 'failed'].includes(status);
          const caution = !providerEvent ? 'A queue or unclassified source status does not independently establish provider delivery or customer receipt.'
            : status === 'accepted' ? 'Provider acceptance does not establish inbox delivery or reading.'
            : status === 'delivered' ? 'Provider-marked delivery does not establish reading, attendance or cardholder identity.'
              : failed ? 'This applies to this listed attempt only; it does not establish that every delivery route failed.'
                : 'Queue or processing state does not establish customer receipt.';
          add(`The ${channel} source records status "${literal(status)}". ${caution}`, [typeof fields.providerStatus === 'string' ? 'providerStatus' : 'state', ...(fields.channel ? ['channel'] : [])], failed ? 'delivery_failure' : 'context', providerEvent && status === 'delivered' ? 'affirmative' : 'excluded');
        }
      }
      if (section === 'history' && fields.action === 'resend_requested') add('The history record shows that a resend was requested. Its outcome must be established by a separate provider record.', ['action'], 'context', 'excluded');
      if (section === 'history' && fields.orderRef === item.orderRef && fields.recoveryCompleted === true) add(`The history record reports a completed recovery flow${integer(fields.recoveredTicketCount) ? ` for ${fields.recoveredTicketCount} tickets` : ''}. This is recorded account access, not attendance.`, ['orderRef', 'recoveryCompleted', ...(integer(fields.recoveredTicketCount) ? ['recoveredTicketCount'] : [])], 'context', 'affirmative');
      if (section === 'support' && fields.orderRef === item.orderRef && fields.messageRole === 'customer' && fields.threadMatch === 'explicit_order_reference' && fields.customerAcknowledgedReceipt === true) {
        add('The selected support export marks a matched customer message as acknowledging receipt for this order. This source acknowledgement flag does not independently establish a delivery channel, attendance or cardholder identity.', ['orderRef', 'messageRole', 'threadMatch', 'customerAcknowledgedReceipt'], 'acknowledged_access', 'affirmative');
      }
      if (section === 'attendance' && typeof fields.result === 'string') add(`A case-linked scan result is recorded as "${literal(fields.result)}". A scan alone does not establish cardholder identity.`, ['result'], 'context', 'excluded');
      if (section === 'policy' && typeof fields.termsVersion === 'string') add(`The order records terms version "${literal(fields.termsVersion)}". This does not establish the historical policy text or that it was presented to the customer.`, ['termsVersion'], 'context', 'excluded');
      // Unknown schemas and free text remain explicitly attributed source material, never inferred facts.
      if (facts.length === before) {
        const excerpt = record.detail.slice(0, 600);
        facts.push({ id: `F${facts.length + 1}`, section, title: record.title, basis: 'attributed_excerpt', role: 'context', packetUse: 'excluded', fieldPaths: [], evidenceIds: [record.id],
          text: `Source excerpt (not independently verified): "${literal(excerpt)}"${record.detail.length > 600 ? ' (excerpt truncated; inspect the original)' : ''}.` });
      }
    }
    return { section, status: source.status, evidenceIds: source.records.map(record => record.id), sourceLimitations: [...new Set(source.limitations)] };
  });
  if (facts.length > 180) throw new InvestigationError('inventory_limit', 'The case exceeds 180 report facts; narrow the selected records.');
  const receiptClaim = item.reason === 'product_not_received';
  const acknowledgements = facts.filter(fact => fact.role === 'acknowledged_access');
  const failures = facts.filter(fact => fact.role === 'delivery_failure');
  const assessment = receiptClaim && failures.length ? 'mixed' : receiptClaim && acknowledgements.length ? 'supported' : 'insufficient';
  const summary = assessment === 'supported'
    ? `Case-linked support fields record a customer acknowledgement of receipt. Attendance and the delivery channel are not inferred. ${cite(acknowledgements.flatMap(fact => fact.evidenceIds))}`
    : assessment === 'mixed'
      ? `Recorded delivery failures support the delivery complaint. Other routes remain unverified. ${cite(failures.flatMap(fact => fact.evidenceIds))}`
      : 'The recognized records do not establish receipt or failed delivery for this claim. Additional source review is required.';
  if (!receiptClaim) gaps.push('Automatic evidence-strength rules cover product_not_received only. This claim requires specialist review.');
  if (facts.some(fact => fact.basis === 'attributed_excerpt')) gaps.push('Some records are quoted source excerpts because their fields have no implemented fact rule. Review their original text and any counterevidence.');
  const hasAffirmative = receiptClaim && facts.some(fact => fact.packetUse === 'affirmative');
  const packetFactIds = hasAffirmative ? facts.filter(fact => fact.packetUse !== 'excluded').map(fact => fact.id) : [];
  const inventory: FactInventory = { version: 1, caseId: item.id, appealPolicy: 'challenge_all', assessment, summary, packetFactIds, synthetic: evidence.some(section => section.sourceMode === 'synthetic'),
    recommendation: 'Prepare a challenge packet under the merchant-selected challenge-all policy. Review the facts, counterevidence, gaps and original exhibits before approving or submitting. This policy is not a prediction of success.',
    facts, gaps: [...new Set(gaps)], coverage };
  if (new TextEncoder().encode(JSON.stringify(inventory)).byteLength > 150000) throw new InvestigationError('inventory_limit', 'The fact inventory exceeds 150 KB; narrow the selected records or source limitations.');
  return inventory;
}

export function defaultPresentation(inventory: FactInventory): PresentationPlan {
  return { sections: EVIDENCE_SECTIONS.map(section => ({ section, factIds: inventory.facts.filter(fact => fact.section === section && inventory.packetFactIds.includes(fact.id)).map(fact => fact.id) })).filter(section => section.factIds.length) };
}

export function validatePresentation(input: unknown, inventory: FactInventory): PresentationPlan {
  const parsed = presentationSchema.safeParse(input);
  if (!parsed.success) throw new InvestigationError('invalid_presentation', 'Return only sections with section and factIds. No generated prose, citations or assessment is accepted.');
  const byId = new Map(inventory.facts.map(fact => [fact.id, fact]));
  const seen = new Set<string>(); const sections = new Set<string>();
  for (const group of parsed.data.sections) {
    if (sections.has(group.section)) throw new InvestigationError('invalid_presentation', 'Each evidence section may appear only once.');
    sections.add(group.section);
    for (const id of group.factIds) {
      if (seen.has(id) || byId.get(id)?.section !== group.section || !inventory.packetFactIds.includes(id)) throw new InvestigationError('invalid_presentation', 'Use each eligible fact exactly once in its original evidence section. Do not invent, duplicate or relabel facts.');
      seen.add(id);
    }
  }
  if (seen.size !== inventory.packetFactIds.length) throw new InvestigationError('invalid_presentation', 'Include every code-selected eligible fact; the internal inventory retains excluded source material.');
  return parsed.data;
}

export function renderFactReport(item: InvestigationInput['case'], inventory: FactInventory, rawPlan: unknown, metrics: InvestigationResult['metrics'], modelId?: string): InvestigationResult {
  const plan = validatePresentation(rawPlan, inventory);
  const byId = new Map(inventory.facts.map(fact => [fact.id, fact]));
  const synthetic = item.source === 'demo' || inventory.synthetic;
  const content = [
    synthetic ? 'SYNTHETIC SAMPLE: NOT FOR SUBMISSION' : 'MERCHANT REVIEW DRAFT — NOT SUBMITTED',
    'We request review of this dispute under the merchant-selected challenge-all policy. The following records and limitations are supplied without predicting the outcome.',
    `Case intake identifies order "${literal(item.orderRef)}", disputed amount ${formatMoney(item.amount, item.currency)}, and reason "${literal(item.reason)}". These are case-intake values, not independently verified findings.`,
    !modelId ? `This ${synthetic ? 'sample ' : ''}report was not analyzed by a language model. Code supplies factual wording and citations.` : 'Code supplies factual wording, citations and assessment. The model arranges the inventory only.',
    inventory.packetFactIds.length ? 'BASIS OF THE CHALLENGE\nWe supply the following selected records of delivery status or acknowledged access, with their transaction context.' : 'NO VERIFIED AFFIRMATIVE SUPPORT SELECTED\nThis case requires manual evidence review before a substantive challenge can be prepared. Payment or issuance alone does not establish receipt. No winning argument is invented.',
    ...plan.sections.map(group => `${SECTION_NAMES[group.section].toUpperCase()}\n${group.factIds.map(id => { const fact = byId.get(id)!; return `${fact.text} ${cite(fact.evidenceIds)}`; }).join('\n\n')}`),
    'Review the original records and the separate internal evidence inventory before approval. Necessary qualifications are retained with each selected statement. Approval and submission remain separate actions.',
  ].join('\n\n');
  if (content.length > 50000) throw new InvestigationError('inventory_limit', 'The verified report exceeds 50,000 characters; narrow the selected records.');
  return { content, summary: inventory.summary, assessment: inventory.assessment, recommendation: inventory.recommendation,
    findings: inventory.facts.map(fact => ({ kind: fact.role === 'delivery_failure' ? 'conflict' : fact.basis === 'attributed_excerpt' ? 'missing' : 'supported', title: fact.title, detail: fact.text, evidenceIds: fact.evidenceIds })),
    gaps: inventory.gaps, evidenceIds: [...new Set(inventory.facts.flatMap(fact => fact.evidenceIds))], metrics,
    ...(modelId ? { modelId } : {}), factInventory: inventory, presentation: plan, claimControl: 'code_generated' };
}
