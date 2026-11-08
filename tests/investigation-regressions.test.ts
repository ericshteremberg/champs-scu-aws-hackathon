import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTicketReport } from '../docs/evaluation/ticket-regressions.mjs';

const directory = new URL('../docs/evaluation/runs/', import.meta.url);
const savedRuns = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(new URL(name, directory), 'utf8')));
const saved = (prefix: string) => structuredClone(savedRuns.find(run => run.run.id.startsWith(prefix)));
const codes = (run: ReturnType<typeof saved>) => checkTicketReport(run).map(issue => issue.code);

describe('ticket reasoning regression rubric', () => {
  it('detects the observed delivery overstatement and case-recap style', () => {
    expect(codes(saved('run_7312fd8d'))).toEqual(expect.arrayContaining(['delivery_overstatement', 'recap_style', 'outcome_or_action_advice']));
  });
  it('detects invented attendance and a resend request cited as its outcome', () => {
    expect(codes(saved('run_501011c7'))).toEqual(expect.arrayContaining(['invented_nonattendance', 'resend_outcome_citation', 'assessment']));
  });
  it('detects the inconsistent label, local event date, refund advice and excessive gaps', () => {
    expect(codes(saved('run_4b86ef67'))).toEqual(expect.arrayContaining(['assessment', 'local_event_date', 'outcome_or_action_advice', 'verbose_gaps']));
  });
  it('detects outcome advice even when an insufficient assessment is correct', () => {
    const result = codes(saved('run_89a52312'));
    expect(result).toContain('outcome_or_action_advice');
    expect(result).not.toContain('assessment');
  });
  it('accepts precise email/SMS statuses and acknowledged account access without calling it attendance', () => {
    const run = saved('run_7312fd8d');
    const id = (source: string) => run.evidence.find((record: { provenance: { originalSourceId: string } }) => record.provenance.originalSourceId === source).id;
    run.draft.content = `We provide records in response to this dispute. Email was accepted for processing; SMS was marked delivered, not read. [${id('email_demo_1042')}] [${id('sms_demo_1042')}] The customer acknowledged finding both tickets in their account. This does not establish attendance. [${id('thread_demo_1042:message_3')}]`;
    run.draft.analysis = { ...run.draft.analysis, summary: 'Customer acknowledged account access. Email acceptance does not establish inbox delivery.', recommendation: 'Review the acknowledgement and original provider statuses.', findings: [], gaps: ['Attendance is unavailable.'] };
    expect(codes(run)).toEqual([]);
  });
  it('accepts counterevidence with a retry-outcome citation, and rejects a swapped request citation', () => {
    const run = saved('run_501011c7');
    const retry = run.evidence.find((record: { provenance: { originalSourceId: string } }) => record.provenance.originalSourceId === 'email_demo_1043_retry').id;
    const request = run.evidence.find((record: { provenance: { originalSourceId: string } }) => record.provenance.originalSourceId === 'resend_demo_1043').id;
    run.draft.content = `We provide the listed delivery failures. The email bounced and SMS was undelivered. The resend also bounced. [${retry}]`;
    run.draft.analysis = { ...run.draft.analysis, assessment: 'mixed', summary: 'Listed delivery failures support the complaint; other routes are unverified.', recommendation: 'Review the delivery attempts and obtain any later acknowledgement.', findings: [], gaps: [] };
    expect(codes(run)).toEqual([]);
    run.draft.content = run.draft.content.replace(retry, request);
    expect(codes(run)).toContain('resend_outcome_citation');
  });
  it('accepts insufficient evidence and the local event date without predicting an outcome', () => {
    const run = saved('run_4b86ef67');
    run.draft.content = 'We provide payment and issuance records. Delivery remains unresolved. The event was November 3, 2026 in America/Los_Angeles.';
    run.draft.analysis = { ...run.draft.analysis, assessment: 'insufficient', summary: 'Neither receipt nor failed delivery is established.', recommendation: 'Obtain order-linked delivery or recovery evidence.', findings: [], gaps: ['Delivery history is unavailable.'] };
    expect(codes(run)).toEqual([]);
    run.draft.content = run.draft.content.replace('November 3', 'November 4');
    expect(codes(run)).toContain('local_event_date');
    run.draft.content = run.draft.content.replace('November 4, 2026 in America/Los_Angeles.', 'November 4, 2026 UTC.');
    expect(codes(run)).not.toContain('local_event_date');
  });
  it('catches missing counterevidence, acknowledgement, repeated gaps and foreign sources', () => {
    const failed = saved('run_501011c7');
    failed.draft.content = 'We provide payment records. [other_case:payment]';
    failed.draft.analysis = { ...failed.draft.analysis, summary: 'Payment recorded.', findings: [], gaps: ['Missing delivery.', 'Missing delivery.'] };
    expect(codes(failed)).toEqual(expect.arrayContaining(['unknown_citation', 'missing_counterevidence', 'duplicate_gaps']));
    const acknowledged = saved('run_7312fd8d');
    acknowledged.draft.content = 'We provide payment records.';
    acknowledged.draft.analysis.summary = 'Payment recorded.';
    acknowledged.draft.analysis.findings = [];
    expect(codes(acknowledged)).toContain('missing_acknowledgement');
  });
  it('distinguishes delivery assertions from the negations observed in the rerun', () => {
    const run = saved('run_89a52312');
    run.draft.analysis = { ...run.draft.analysis, summary: '', findings: [], recommendation: 'Obtain delivery records.', gaps: [] };
    for (const content of [
      'We cannot confirm that the tickets were delivered to or accessed by the customer.',
      'The evidence does not establish whether the tickets were delivered.',
      'No delivery records are available to confirm how or whether tickets were delivered.',
      'No delivery records are available to confirm how or if tickets were delivered.',
      'There is no evidence that the tickets were delivered.',
    ]) {
      run.draft.content = content;
      expect(codes(run)).not.toContain('missing_history_as_delivery');
    }
    run.draft.content = 'The tickets were delivered to the customer.';
    expect(codes(run)).toContain('missing_history_as_delivery');
  });
  it('requires an issuance citation rather than an order-only citation for the observed rerun wording', () => {
    const run = saved('run_89a52312');
    const order = run.evidence.find((record: { provenance: { section: string } }) => record.provenance.section === 'order').id;
    const ticket = run.evidence.find((record: { provenance: { section: string } }) => record.provenance.section === 'tickets').id;
    run.draft.analysis = { ...run.draft.analysis, summary: '', findings: [], recommendation: 'Obtain delivery records.', gaps: [] };
    run.draft.content = `The order shows two tickets were issued. [${order}]`;
    expect(codes(run)).toContain('issuance_source_citation');
    run.draft.content = `Tickets were issued. [${ticket}]`;
    expect(codes(run)).not.toContain('issuance_source_citation');
  });
});
