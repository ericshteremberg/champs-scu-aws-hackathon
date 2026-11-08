import type { DisputeCase, Draft, Evidence, WorkspaceState } from '../domain';
import { screenManifest } from './screens';

/** In-memory synthetic data only. Nothing in this module connects or submits to a service. */
export type ScreenPreview = {
  id: string;
  state: WorkspaceState;
  view?: string;
  caseId?: string;
  modal?: string | null;
  detail?: Record<string, string>;
  onboardingStep?: number;
  evidenceMode?: string;
  mode?: 'normal' | 'loading' | 'error' | 'session';
  unsaved?: boolean;
  search?: string;
  error?: string;
  healthError?: string;
  stripe?: {
    configured?: boolean;
    connected?: boolean;
    submissionEnabled?: boolean;
    mode?: string;
    message?: string;
  };
};

const CREATED_AT = '2026-11-02T16:30:00.000Z';
const REVIEWED_AT = '2026-11-07T17:10:00.000Z';
const SYNTHETIC_OWNER = 'Alex Morgan · sample owner';

const mainEvidence: Evidence[] = [
  {
    id: 'e-payment', caseId: 'case-main', source: 'stripe',
    title: 'Payment captured for order #1048',
    content: 'SYNTHETIC SOURCE RECORD\nPayment of $248.00 USD was captured on October 28 for order #1048. Billing email matches the order record. No refund appears in this selected payment export. Payment authorization does not establish delivery or receipt.',
    occurredAt: '2026-10-28T16:42:00.000Z', reference: 'Sample payment export · order #1048',
  },
  {
    id: 'e-delivery', caseId: 'case-main', source: 'database',
    title: 'Carrier marked parcel delivered',
    content: 'SYNTHETIC SOURCE RECORD\nOrder #1048 was dispatched October 29. The selected carrier record shows “Delivered — front entrance” at 2:14 PM on November 1. No delivery photograph or recipient signature is included. This scan records a carrier event; it does not independently prove the customer received the parcel.',
    occurredAt: '2026-11-01T21:14:00.000Z', reference: 'Sample fulfillment export · shipment SH-1048',
  },
  {
    id: 'e-email', caseId: 'case-main', source: 'gmail',
    title: 'Customer reports parcel never arrived',
    content: 'SYNTHETIC CUSTOMER MESSAGE\nFrom: mina.patel@example.com\nSubject: Order #1048 has not arrived\n\n“Tracking says delivered, but I did not receive the package. I checked the front entrance and asked my neighbor. Could you help me locate it?”\n\nThe selected message identifies the order and describes a non-receipt claim. No unrelated mailbox content is included.',
    occurredAt: '2026-11-02T09:18:00.000Z', reference: 'Selected sample email · November 2',
  },
  {
    id: 'e-policy', caseId: 'case-main', source: 'policy',
    title: 'Delivery and returns policy · October version',
    content: 'SYNTHETIC POLICY SNAPSHOT\nEffective October 1, 2026. Customers should contact support when an order is marked delivered but cannot be located. The merchant investigates with the carrier before determining the appropriate resolution. This policy does not establish whether this customer received the parcel.',
    occurredAt: '2026-10-01T00:00:00.000Z', reference: 'Sample policy version · effective October 1, 2026',
  },
];

const mainDraft: Draft = {
  revision: 3, status: 'draft', method: 'evidence_template', generatedAt: REVIEWED_AT,
  content: `SYNTHETIC MERCHANT REVIEW DRAFT — NOT SUBMITTED

CASE SUMMARY
Mina Patel disputes the $248.00 payment for order #1048 because the parcel was not received. The selected payment export matches the order and billing email. [E1]

WHAT THE RECORDS SHOW
October 28 — Payment was captured for order #1048. [E1]
November 1 — The carrier recorded delivery at the front entrance. No photograph or recipient signature is present in the selected record. [E2]
November 2 — The customer reported non-receipt and said they had checked the entrance and with a neighbor. [E3]

CONFLICTING EVIDENCE
The carrier event and the customer account differ. The delivery scan alone does not establish receipt by this customer. [E2, E3]

MISSING INFORMATION
Request the delivery photograph or recipient confirmation for this shipment only. Do not characterize the customer's report as false without additional evidence.

RECOMMENDED NEXT STEP
Review the original records, resolve the delivery discrepancy if possible, and decide whether the available evidence supports a response. The applicable policy calls for a carrier investigation. [E4]

Approval applies only to this saved revision. The issuing bank decides the dispute outcome.`,
};

const mainCase: DisputeCase = {
  id: 'case-main', title: 'Delivery recorded. Receipt disputed.', customerName: 'Mina Patel',
  email: 'mina.patel@example.com', amount: 24800, currency: 'usd', status: 'investigating',
  reason: 'Product not received', orderRef: '#1048', dueAt: '2026-11-14T23:59:59.000Z',
  source: 'demo', createdAt: CREATED_AT, updatedAt: REVIEWED_AT,
  evidence: mainEvidence,
  findings: [
    { kind: 'supported', title: 'The payment matches the order', detail: 'The selected payment and order records share the same order reference and customer email. This establishes a match, not proof of receipt.', evidenceIds: ['e-payment', 'e-delivery'] },
    { kind: 'conflict', title: 'Delivery and receipt accounts differ', detail: 'The carrier recorded delivery; the customer reports non-receipt. A carrier scan alone cannot resolve the discrepancy.', evidenceIds: ['e-delivery', 'e-email'] },
    { kind: 'missing', title: 'Recipient confirmation is unresolved', detail: 'The selected records include neither a delivery photograph nor a recipient signature. Request only the confirmation for this shipment.', evidenceIds: ['e-delivery'] },
  ],
  draft: mainDraft,
};

const emptyCase: DisputeCase = {
  id: 'case-empty', title: 'A new case, ready to investigate.', customerName: 'Eliot Stone',
  email: 'eliot.stone@example.com', amount: 12900, currency: 'usd', status: 'needs_review',
  reason: 'Service not received', orderRef: '#1057', dueAt: '2026-11-18T23:59:59.000Z',
  source: 'demo', createdAt: '2026-11-07T16:45:00.000Z', updatedAt: '2026-11-07T16:45:00.000Z',
  evidence: [], findings: [],
};

const customerCase: DisputeCase = {
  id: 'case-customer', title: 'Cancellation predates renewal.', customerName: 'Jess Moreno',
  email: 'jess.moreno@example.com', amount: 7900, currency: 'usd', status: 'needs_review',
  reason: 'Canceled recurring transaction', orderRef: '#1031', dueAt: '2026-11-12T23:59:59.000Z',
  source: 'demo', createdAt: CREATED_AT, updatedAt: REVIEWED_AT,
  evidence: [
    { id: 'e-cancellation', caseId: 'case-customer', source: 'gmail', title: 'Customer requested cancellation before renewal', content: 'SYNTHETIC SOURCE RECORD\nOn October 26, the customer asked to cancel the subscription before its November 1 renewal. The selected support reply acknowledged the cancellation request.', occurredAt: '2026-10-26T15:05:00.000Z', reference: 'Selected sample support thread' },
    { id: 'e-renewal', caseId: 'case-customer', source: 'stripe', title: 'Renewal payment was captured afterward', content: 'SYNTHETIC SOURCE RECORD\nThe selected payment export shows a $79.00 renewal charge on November 1, after the cancellation acknowledgement. No refund is included in this selected export.', occurredAt: '2026-11-01T09:00:00.000Z', reference: 'Sample renewal export · #1031' },
  ],
  findings: [
    { kind: 'conflict', title: 'The records support the customer account', detail: 'The acknowledged cancellation preceded the renewal charge. The collected evidence does not support claiming that the customer authorized this renewal.', evidenceIds: ['e-cancellation', 'e-renewal'] },
    { kind: 'missing', title: 'Confirm whether a refund was issued', detail: 'Check the relevant refund record before choosing the next action. The selected export does not establish that no refund exists elsewhere.', evidenceIds: ['e-renewal'] },
  ],
  draft: { revision: 1, status: 'draft', method: 'evidence_template', generatedAt: REVIEWED_AT, content: 'SYNTHETIC MERCHANT REVIEW DRAFT — NOT SUBMITTED\n\nJess Moreno disputes a $79.00 renewal after cancellation. The selected support thread acknowledged cancellation on October 26. [E1] A renewal payment was captured November 1. [E2]\n\nThe available records support the customer’s account. Confirm the refund status and review an appropriate resolution instead of preparing an unsupported denial. This draft does not accept the dispute or issue a refund.' },
};

function lifecycleCase(id: string, status: DisputeCase['status'], name: string, order: string, amount: number): DisputeCase {
  const evidence = mainEvidence.slice(0, 2).map((record, index) => ({
    ...record, id: `${id}-e${index + 1}`, caseId: id,
    title: index ? 'Selected fulfillment record' : 'Selected payment record',
    content: `SYNTHETIC LIFECYCLE EXAMPLE\nThis record belongs to sample ${order}. It exists only to demonstrate the ${status} screen. No real payment, dispute, submission or bank decision is represented.`,
    reference: `Synthetic lifecycle sample · ${order}`,
  }));
  return {
    id, title: status === 'won' ? 'Bank review completed · won' : status === 'lost' ? 'Bank review completed · lost' : status === 'submitting' ? 'Submission status needs verification' : 'Response submitted for bank review',
    customerName: name, email: `${name.toLowerCase().replace(' ', '.')}@example.com`, amount, currency: 'usd',
    status, reason: 'Product not received', orderRef: order, dueAt: '2026-11-10T23:59:59.000Z',
    source: 'demo', createdAt: CREATED_AT, updatedAt: REVIEWED_AT, evidence, findings: [],
    draft: { revision: 2, status: 'approved', generatedAt: CREATED_AT, approvedAt: REVIEWED_AT, approvedBy: SYNTHETIC_OWNER, method: 'evidence_template', content: `SYNTHETIC APPROVED RESPONSE · ${order}\n\nThis saved response illustrates the ${status} lifecycle state. Selected source records are preserved for review. It does not represent an actual Stripe submission or bank decision.\n\nNo financial recovery is inferred from this sample status.` },
  };
}

const baseState: WorkspaceState = {
  user: { id: 'design-owner', name: 'Alex Morgan', email: 'alex@example.com' },
  workspace: { id: 'workspace-design-sample', name: 'Northline Goods · Sample', industry: 'Retail and ecommerce', website: 'https://example.com', onboardingComplete: true, retentionDays: 90, createdAt: CREATED_AT },
  cases: [
    mainCase, emptyCase, customerCase,
    lifecycleCase('case-verifying', 'submitting', 'Sam Rivera', '#1042', 18600),
    lifecycleCase('case-submitted', 'submitted', 'Avery Chen', '#1029', 32000),
    lifecycleCase('case-won', 'won', 'Jordan Ellis', '#1016', 15400),
    lifecycleCase('case-lost', 'lost', 'Taylor Reed', '#1008', 9800),
  ],
  integrations: [
    { id: 'integration-stripe', provider: 'stripe', name: 'Stripe', status: 'configuration_required', description: 'Not connected. This design preview does not use a Stripe account or import real disputes.' },
    { id: 'integration-gmail', provider: 'gmail', name: 'Gmail', status: 'not_connected', description: 'Selected messages can be imported manually. Mailbox authorization is not implemented.' },
    { id: 'integration-database', provider: 'database', name: 'Company records', status: 'configuration_required', description: 'The separate access gateway is not connected. Import only approved, selected records.' },
  ],
  activity: [
    { id: 'activity-1', action: 'draft.prepared', detail: 'Sample response revision 3 assembled from four selected records.', actor: SYNTHETIC_OWNER, caseId: 'case-main', createdAt: REVIEWED_AT },
    { id: 'activity-2', action: 'access.requested', detail: 'Delivery confirmation requested for order #1048 only. No access was granted.', actor: SYNTHETIC_OWNER, caseId: 'case-main', createdAt: '2026-11-07T16:52:00.000Z' },
    { id: 'activity-3', action: 'evidence.added', detail: 'Selected customer email attached to the sample case.', actor: SYNTHETIC_OWNER, caseId: 'case-main', createdAt: '2026-11-07T16:40:00.000Z' },
    { id: 'activity-4', action: 'policy.added', detail: 'Delivery and returns policy saved with an effective date. Policies do not grant data access.', actor: SYNTHETIC_OWNER, createdAt: '2026-11-06T14:20:00.000Z' },
    { id: 'activity-5', action: 'workspace.created', detail: 'Synthetic workspace created for the design preview.', actor: SYNTHETIC_OWNER, createdAt: CREATED_AT },
  ],
  accessRequests: [
    { id: 'request-main', caseId: 'case-main', scope: 'Delivery photograph and recipient signature for order #1048 only', reason: 'The carrier event and customer account conflict. Recipient confirmation may help establish what happened without exposing unrelated customer records.', status: 'pending', requestedBy: SYNTHETIC_OWNER, createdAt: '2026-11-07T16:52:00.000Z', canReview: false },
  ],
  policies: [
    { id: 'policy-delivery-oct', name: 'Delivery and returns', content: 'SYNTHETIC POLICY · Effective October 1, 2026. Customers should contact support when an order is marked delivered but cannot be located. The merchant investigates with the carrier before determining the appropriate resolution. Return requests are assessed under the terms applicable at purchase. This text is evidence of terms; it does not grant access to customer records.', effectiveDate: '2026-10-01', createdAt: '2026-11-06T14:20:00.000Z' },
    { id: 'policy-cancel-oct', name: 'Subscription cancellation', content: 'SYNTHETIC POLICY · Effective October 1, 2026. A cancellation acknowledged before the next renewal date should stop that renewal. When a renewal occurs after an acknowledged cancellation, support reviews the payment and refund records before determining the resolution.', effectiveDate: '2026-10-01', createdAt: '2026-11-06T14:22:00.000Z' },
    { id: 'policy-delivery-jul', name: 'Delivery and returns · previous version', content: 'SYNTHETIC POLICY · Effective July 1, 2026. This previous policy version is preserved for purchases made while it applied. Review the purchase date before selecting a policy. Do not substitute later terms for the version in effect at purchase.', effectiveDate: '2026-07-01', createdAt: '2026-11-06T14:24:00.000Z' },
  ],
};

function copyState(): WorkspaceState {
  return JSON.parse(JSON.stringify(baseState)) as WorkspaceState;
}

function approveMain(state: WorkspaceState): void {
  const current = state.cases.find(item => item.id === 'case-main')!;
  current.status = 'ready';
  current.draft = { ...current.draft!, status: 'approved', approvedAt: REVIEWED_AT, approvedBy: SYNTHETIC_OWNER };
}

/** Every call returns an isolated copy so one interactive preview cannot change another. */
export function getScreenPreview(id: string): ScreenPreview {
  const known = screenManifest.some(screen => screen.id === id);
  const preview: ScreenPreview = {
    id: known ? id : 'page-not-found', state: copyState(), view: 'overview', mode: 'normal',
    stripe: { configured: false, connected: false, submissionEnabled: false, message: 'Stripe is deliberately disconnected. This is a synthetic design preview.' },
  };
  const showCase = (caseId = 'case-main', tab = 'investigation') => {
    preview.view = 'cases'; preview.caseId = caseId; preview.detail = { tab };
  };
  switch (preview.id) {
    case 'landing': case 'login': case 'overview-demo': break;
    case 'overview-populated':
      // Exercise the real-case metric path with synthetic manual-case fixtures.
      // Design mode still blocks all API mutations and labels this entire view.
      preview.state.cases = preview.state.cases.map(c =>
        ['case-main', 'case-empty', 'case-customer'].includes(c.id) ? { ...c, source: 'manual' } : c);
      break;
    case 'onboarding-business': case 'onboarding-sources': case 'onboarding-oversight':
      preview.state.workspace = null;
      preview.state.cases = []; preview.state.policies = []; preview.state.activity = []; preview.state.accessRequests = [];
      preview.onboardingStep = ['onboarding-business', 'onboarding-sources', 'onboarding-oversight'].indexOf(preview.id);
      break;
    case 'setup-checklist': preview.view = 'setup'; break;
    case 'overview-empty':
      preview.state.cases = []; preview.state.policies = []; preview.state.activity = []; preview.state.accessRequests = [];
      break;
    case 'case-queue': preview.view = 'cases'; break;
    case 'case-search-empty': preview.view = 'cases'; preview.search = 'order #9999'; break;
    case 'case-create': preview.view = 'cases'; preview.modal = 'case'; break;
    case 'case-investigation': showCase(); preview.detail!.evidence = 'e-delivery'; break;
    case 'case-evidence-empty': showCase('case-empty'); break;
    case 'case-finding': showCase(); preview.detail!.evidence = 'e-email'; break;
    case 'case-customer-supported': showCase('case-customer', 'report'); break;
    case 'report-review': showCase('case-main', 'report'); break;
    case 'report-unsaved': showCase('case-main', 'report'); preview.unsaved = true; break;
    case 'report-approved': approveMain(preview.state); showCase('case-main', 'report'); break;
    case 'report-preview': showCase('case-main', 'preview'); break;
    case 'submission-readiness': approveMain(preview.state); showCase('case-main', 'submission'); break;
    case 'submission-confirm': approveMain(preview.state); showCase('case-main', 'submission'); preview.modal = 'submit'; break;
    case 'submission-verifying': showCase('case-verifying', 'submission'); break;
    case 'submission-receipt': showCase('case-submitted', 'submission'); break;
    case 'outcome-won': showCase('case-won', 'submission'); break;
    case 'outcome-lost': showCase('case-lost', 'submission'); break;
    case 'evidence-library': preview.view = 'evidence'; break;
    case 'evidence-record': showCase(); preview.modal = 'evidence'; preview.evidenceMode = 'record'; break;
    case 'evidence-file': showCase(); preview.modal = 'evidence'; preview.evidenceMode = 'file'; break;
    case 'evidence-original':
      showCase();
      preview.state.cases[0].evidence.push({ id: 'e-file', caseId: 'case-main', source: 'manual', title: 'Selected delivery receipt · original file', content: 'SYNTHETIC ATTACHMENT METADATA\nThis preview illustrates the original-file inspection state. No actual file was uploaded and no text was extracted from a PDF or image. In the application, open the privately stored original to inspect its contents.', occurredAt: '2026-11-07T17:00:00.000Z', reference: 'Synthetic original-file example', fileName: 'delivery-receipt-sample.pdf', mimeType: 'application/pdf' });
      preview.detail!.evidence = 'e-file'; break;
    case 'policy-library': preview.view = 'policies'; break;
    case 'policy-create': preview.view = 'policies'; preview.modal = 'policy'; break;
    case 'policy-attach': showCase(); preview.modal = 'attach-policy'; break;
    case 'connections-overview': preview.view = 'integrations'; break;
    case 'stripe-setup': case 'gmail-setup': case 'database-setup':
      preview.view = 'integrations'; preview.detail = { source: preview.id.replace('-setup', '') }; break;
    case 'scope-configuration': preview.view = 'scope'; break;
    case 'scope-disclosure-preview': preview.view = 'scope'; preview.detail = { tab: 'preview' }; break;
    case 'source-health':
      preview.view = 'integrations'; preview.detail = { source: 'stripe' };
      preview.healthError = 'Connection status could not be checked. No records were imported. Stripe remains disconnected; retry when the configured service is available.'; break;
    case 'access-requests': preview.view = 'access'; preview.detail = { tab: 'requests' }; break;
    case 'access-create': showCase(); preview.modal = 'access'; break;
    case 'access-detail': preview.view = 'access'; preview.detail = { request: 'request-main' }; break;
    case 'activity-log': preview.view = 'access'; preview.detail = { tab: 'activity' }; break;
    case 'access-architecture': preview.view = 'access'; preview.detail = { tab: 'model' }; break;
    case 'settings-business': preview.view = 'settings'; break;
    case 'settings-account': preview.view = 'settings'; preview.detail = { tab: 'account' }; break;
    case 'loading': preview.mode = 'loading'; break;
    case 'load-error': preview.mode = 'error'; preview.error = 'The workspace could not be loaded. Your saved records have not changed.'; break;
    case 'session-expired': preview.mode = 'session'; break;
    case 'case-not-found': showCase('case-unavailable'); break;
    case 'page-not-found': break;
    case 'action-error':
      showCase(); preview.modal = 'evidence'; preview.evidenceMode = 'file';
      preview.error = 'That file could not be uploaded. Select a PDF, PNG, JPEG, email, text, CSV or JSON file no larger than 10 MB.'; break;
  }
  return preview;
}
