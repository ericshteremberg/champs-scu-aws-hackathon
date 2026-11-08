// Fixture-specific regression signals, not a general semantic validator or production gate.
// A clean result still requires source-level review. These checks never rewrite model output.
export const expectedAssessments = { 'ATM-1042': 'supported', 'ATM-1043': 'mixed', 'ATM-1044': 'insufficient' };

export function checkTicketReport({ order, draft, evidence }) {
  if (!expectedAssessments[order]) throw new Error(`No regression rubric for ${order}`);
  const report = draft.analysis;
  const narrative = draft.content.replaceAll('\\n', '\n').split(/\n\nSOURCE LIMITATIONS\n/i)[0];
  const claims = `${report.summary}\n${narrative}\n${report.findings.map(finding => finding.detail).join('\n')}`;
  const records = new Map(evidence.map(record => [record.id, record]));
  const issues = [];
  const add = (code, message, severity = 'failure') => issues.push({ code, severity, message });
  if (report.assessment !== expectedAssessments[order]) add('assessment', `Expected ${expectedAssessments[order]}, observed ${report.assessment}.`);
  const citedIds = new Set([
    ...[...narrative.matchAll(/(?<!\\)\[([^\[\]\r\n]+)\]/g)].map(match => match[1]),
    ...report.findings.flatMap(finding => finding.evidenceIds),
  ]);
  if ([...citedIds].some(id => !records.has(id))) add('unknown_citation', 'A citation does not belong to this case.');
  if (/\b(?:did not|didn't|never) attend(?:ed)?\b|customer'?s? claim of non[- ]attendance/i.test(claims)) add('invented_nonattendance', 'The fixture complaint does not assert nonattendance.');
  const advice = `${report.recommendation}\n${narrative}`;
  if (/(?:consider|recommend\w*|suggest\w*|should|may need to)\b[^.!?\n]{0,100}\b(?:refund\w*|resend\w*|clos(?:e|ing)|contest\w*|escalat\w*)|\b(?:can|should|must) contest\b|\b(?:closing the dispute|escalated to a higher authority|balance of probabilities|may lean toward|likely to (?:win|lose))\b/i.test(advice)) add('outcome_or_action_advice', 'Draft or recommendation suggests an action/outcome beyond evidence review.');
  if (/^(?:This case (?:involves|concerns)|We have a payment captured|The customer claims)/i.test(narrative.trim())) add('recap_style', 'Draft opens as a case recap rather than a merchant response.', 'review');
  if (report.gaps.length > 12) add('verbose_gaps', `${report.gaps.length} gap entries; check semantic repetition.`, 'review');
  if (new Set(report.gaps.map(gap => gap.trim().toLowerCase())).size !== report.gaps.length) add('duplicate_gaps', 'Identical gap entries are repeated.');

  if (order === 'ATM-1042') {
    for (const sentence of claims.split(/(?<=[.!?])\s+|\n+/)) {
      if (/\b(?:tickets (?:were |had been |have been )?delivered|issued and delivered|delivered via email)\b/i.test(sentence)
        && !/cannot|not establish|not confirm|does not prove|unverified|unknown|not recorded|no (?:proof|evidence)/i.test(sentence)) {
        add('delivery_overstatement', 'Delivery wording exceeds the email accepted / SMS marked-delivered statuses; inspect acknowledgement wording.'); break;
      }
    }
    if (!/acknowledg|found both tickets|confirmed.{0,30}access/i.test(claims)) add('missing_acknowledgement', 'Customer acknowledgement of ticket access is missing.');
  }
  if (order === 'ATM-1043') {
    if (!/bounc|mailbox/i.test(claims) || !/undelivered/i.test(claims)) add('missing_counterevidence', 'Email failure or undelivered SMS is missing.');
    // Some models put a citation just after the sentence punctuation.
    const sentences = narrative.replace(/([.!?])\s+((?:\[[^\]]+\]\s*)+)/g, ' $2$1 ').split(/(?<=[.!?])\s+|\n+/);
    for (const sentence of sentences) {
      if (!/resen[dt]|retry/i.test(sentence) || !/fail|bounc/i.test(sentence)) continue;
      const ids = [...sentence.matchAll(/\[([^\[\]]+)\]/g)].map(match => match[1]);
      if (!ids.some(id => records.get(id)?.provenance?.originalSourceId === 'email_demo_1043_retry')) {
        add('resend_outcome_citation', 'A retry-failure statement lacks the bounced retry outcome citation.'); break;
      }
    }
  }
  if (order === 'ATM-1044') {
    if (/November 4,? 2026(?![^.!?\n]{0,35}\bUTC\b)/i.test(claims)) add('local_event_date', 'Local event date is November 3 in America/Los_Angeles; November 4 must be explicitly UTC.');
    for (const match of claims.matchAll(/\btickets (?:were|have been) (?:successfully )?delivered\b/gi)) {
      const before = claims.slice(Math.max(0, match.index - 100), match.index);
      if (/\b(?:cannot confirm(?: that)?|does not establish whether|whether|if|no (?:proof|evidence)(?: that)?)\s+(?:the\s+)?$/i.test(before)) continue;
      add('missing_history_as_delivery', 'Missing history is being treated as delivery.'); break;
    }
    for (const sentence of narrative.replace(/([.!?])\s+((?:\[[^\]]+\]\s*)+)/g, ' $2$1 ').split(/(?<=[.!?])\s+|\n+/)) {
      if (!/\btickets? (?:were|was|are|is|had been) issued\b/i.test(sentence)) continue;
      const ids = [...sentence.matchAll(/\[([^\[\]]+)\]/g)].map(match => match[1]);
      if (!ids.some(id => records.get(id)?.provenance?.section === 'tickets')) {
        add('issuance_source_citation', 'An issuance sentence cites no ticket-issuance record; the order record alone confirms the order, not issuance.'); break;
      }
    }
    if (/\bno (?:scan |attendance )?records exist\b/i.test(claims)) add('unscoped_absence', 'Prefer records unavailable or no scan recorded in the selected records over a claim that no records exist.', 'review');
  }
  return issues;
}
