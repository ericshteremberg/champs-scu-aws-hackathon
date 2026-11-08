/** Desktop screen/state catalog. These paths display synthetic design previews. */
export type ScreenDefinition = {
  id: string;
  title: string;
  group: string;
  path: string;
  kind: 'screen' | 'modal' | 'state';
};

export const screenManifest: ScreenDefinition[] = [
  {
    "id": "landing",
    "title": "Landing page",
    "group": "Marketing",
    "path": "/",
    "kind": "screen"
  },
  {
    "id": "login",
    "title": "Managed sign-in",
    "group": "Identity",
    "path": "/design/screens?screen=login",
    "kind": "screen"
  },
  {
    "id": "onboarding-business",
    "title": "Business profile",
    "group": "Onboarding",
    "path": "/design/screens?screen=onboarding-business",
    "kind": "screen"
  },
  {
    "id": "onboarding-sources",
    "title": "Choose evidence sources",
    "group": "Onboarding",
    "path": "/design/screens?screen=onboarding-sources",
    "kind": "screen"
  },
  {
    "id": "onboarding-oversight",
    "title": "Oversight and workspace creation",
    "group": "Onboarding",
    "path": "/design/screens?screen=onboarding-oversight",
    "kind": "screen"
  },
  {
    "id": "setup-checklist",
    "title": "Workspace setup checklist",
    "group": "Onboarding",
    "path": "/design/screens?screen=setup-checklist",
    "kind": "screen"
  },
  {
    "id": "overview-populated",
    "title": "Overview",
    "group": "Workspace",
    "path": "/design/screens?screen=overview-populated",
    "kind": "screen"
  },
  {
    "id": "overview-empty",
    "title": "First workspace",
    "group": "Workspace",
    "path": "/design/screens?screen=overview-empty",
    "kind": "state"
  },
  {
    "id": "overview-demo",
    "title": "Synthetic sample workspace",
    "group": "Workspace",
    "path": "/design/screens?screen=overview-demo",
    "kind": "state"
  },
  {
    "id": "case-queue",
    "title": "Case queue",
    "group": "Cases",
    "path": "/design/screens?screen=case-queue",
    "kind": "screen"
  },
  {
    "id": "case-search-empty",
    "title": "No matching cases",
    "group": "Cases",
    "path": "/design/screens?screen=case-search-empty",
    "kind": "state"
  },
  {
    "id": "case-create",
    "title": "Create manual case",
    "group": "Cases",
    "path": "/design/screens?screen=case-create",
    "kind": "modal"
  },
  {
    "id": "case-investigation",
    "title": "Investigation and source timeline",
    "group": "Cases",
    "path": "/design/screens?screen=case-investigation",
    "kind": "screen"
  },
  {
    "id": "case-evidence-empty",
    "title": "Case awaiting evidence",
    "group": "Cases",
    "path": "/design/screens?screen=case-evidence-empty",
    "kind": "state"
  },
  {
    "id": "case-finding",
    "title": "Finding with cited sources",
    "group": "Cases",
    "path": "/design/screens?screen=case-finding",
    "kind": "screen"
  },
  {
    "id": "case-customer-supported",
    "title": "Evidence supports customer account",
    "group": "Cases",
    "path": "/design/screens?screen=case-customer-supported",
    "kind": "state"
  },
  {
    "id": "report-review",
    "title": "Merchant report review",
    "group": "Reports",
    "path": "/design/screens?screen=report-review",
    "kind": "screen"
  },
  {
    "id": "report-unsaved",
    "title": "Unsaved or stale report",
    "group": "Reports",
    "path": "/design/screens?screen=report-unsaved",
    "kind": "state"
  },
  {
    "id": "report-approved",
    "title": "Approved report",
    "group": "Reports",
    "path": "/design/screens?screen=report-approved",
    "kind": "state"
  },
  {
    "id": "report-preview",
    "title": "Readable report preview/export",
    "group": "Reports",
    "path": "/design/screens?screen=report-preview",
    "kind": "screen"
  },
  {
    "id": "submission-readiness",
    "title": "Submission readiness and package",
    "group": "Submission",
    "path": "/design/screens?screen=submission-readiness",
    "kind": "screen"
  },
  {
    "id": "submission-confirm",
    "title": "Review exact submission",
    "group": "Submission",
    "path": "/design/screens?screen=submission-confirm",
    "kind": "modal"
  },
  {
    "id": "submission-verifying",
    "title": "Submission verification required",
    "group": "Submission",
    "path": "/design/screens?screen=submission-verifying",
    "kind": "state"
  },
  {
    "id": "submission-receipt",
    "title": "Submitted confirmation",
    "group": "Submission",
    "path": "/design/screens?screen=submission-receipt",
    "kind": "screen"
  },
  {
    "id": "outcome-won",
    "title": "Dispute won",
    "group": "Submission",
    "path": "/design/screens?screen=outcome-won",
    "kind": "screen"
  },
  {
    "id": "outcome-lost",
    "title": "Dispute lost",
    "group": "Submission",
    "path": "/design/screens?screen=outcome-lost",
    "kind": "screen"
  },
  {
    "id": "evidence-library",
    "title": "Evidence library",
    "group": "Evidence",
    "path": "/design/screens?screen=evidence-library",
    "kind": "screen"
  },
  {
    "id": "evidence-record",
    "title": "Add source record",
    "group": "Evidence",
    "path": "/design/screens?screen=evidence-record",
    "kind": "modal"
  },
  {
    "id": "evidence-file",
    "title": "Upload original file",
    "group": "Evidence",
    "path": "/design/screens?screen=evidence-file",
    "kind": "modal"
  },
  {
    "id": "evidence-original",
    "title": "Original record/file details",
    "group": "Evidence",
    "path": "/design/screens?screen=evidence-original",
    "kind": "screen"
  },
  {
    "id": "policy-library",
    "title": "Company policies",
    "group": "Policies",
    "path": "/design/screens?screen=policy-library",
    "kind": "screen"
  },
  {
    "id": "policy-create",
    "title": "Add policy version",
    "group": "Policies",
    "path": "/design/screens?screen=policy-create",
    "kind": "modal"
  },
  {
    "id": "policy-attach",
    "title": "Attach applicable policy to case",
    "group": "Policies",
    "path": "/design/screens?screen=policy-attach",
    "kind": "modal"
  },
  {
    "id": "connections-overview",
    "title": "Connections overview",
    "group": "Sources",
    "path": "/design/screens?screen=connections-overview",
    "kind": "screen"
  },
  {
    "id": "stripe-setup",
    "title": "Stripe setup and environment",
    "group": "Sources",
    "path": "/design/screens?screen=stripe-setup",
    "kind": "screen"
  },
  {
    "id": "gmail-setup",
    "title": "Customer email import/setup",
    "group": "Sources",
    "path": "/design/screens?screen=gmail-setup",
    "kind": "screen"
  },
  {
    "id": "database-setup",
    "title": "Company data access setup",
    "group": "Sources",
    "path": "/design/screens?screen=database-setup",
    "kind": "screen"
  },
  {
    "id": "scope-configuration",
    "title": "Allowed data and redaction draft",
    "group": "Sources",
    "path": "/design/screens?screen=scope-configuration",
    "kind": "screen"
  },
  {
    "id": "scope-disclosure-preview",
    "title": "Disclosure preview and access summary",
    "group": "Sources",
    "path": "/design/screens?screen=scope-disclosure-preview",
    "kind": "screen"
  },
  {
    "id": "source-health",
    "title": "Connection issue / reconnect",
    "group": "Sources",
    "path": "/design/screens?screen=source-health",
    "kind": "state"
  },
  {
    "id": "access-requests",
    "title": "Access request queue",
    "group": "Governance",
    "path": "/design/screens?screen=access-requests",
    "kind": "screen"
  },
  {
    "id": "access-create",
    "title": "Request additional access",
    "group": "Governance",
    "path": "/design/screens?screen=access-create",
    "kind": "modal"
  },
  {
    "id": "access-detail",
    "title": "Access request detail",
    "group": "Governance",
    "path": "/design/screens?screen=access-detail",
    "kind": "screen"
  },
  {
    "id": "activity-log",
    "title": "Audit/activity log",
    "group": "Governance",
    "path": "/design/screens?screen=activity-log",
    "kind": "screen"
  },
  {
    "id": "access-architecture",
    "title": "Access model",
    "group": "Governance",
    "path": "/design/screens?screen=access-architecture",
    "kind": "screen"
  },
  {
    "id": "settings-business",
    "title": "Business and retention settings",
    "group": "Settings",
    "path": "/design/screens?screen=settings-business",
    "kind": "screen"
  },
  {
    "id": "settings-account",
    "title": "Identity and workspace access",
    "group": "Settings",
    "path": "/design/screens?screen=settings-account",
    "kind": "screen"
  },
  {
    "id": "loading",
    "title": "Workspace loading",
    "group": "Recovery",
    "path": "/design/screens?screen=loading",
    "kind": "state"
  },
  {
    "id": "load-error",
    "title": "Workspace error with retry",
    "group": "Recovery",
    "path": "/design/screens?screen=load-error",
    "kind": "state"
  },
  {
    "id": "session-expired",
    "title": "Session expired / sign-in required",
    "group": "Recovery",
    "path": "/design/screens?screen=session-expired",
    "kind": "state"
  },
  {
    "id": "case-not-found",
    "title": "Case not found / unavailable",
    "group": "Recovery",
    "path": "/design/screens?screen=case-not-found",
    "kind": "state"
  },
  {
    "id": "page-not-found",
    "title": "Unknown page",
    "group": "Recovery",
    "path": "/design/screens?screen=page-not-found",
    "kind": "screen"
  },
  {
    "id": "action-error",
    "title": "Mutation/validation/upload failure",
    "group": "Recovery",
    "path": "/design/screens?screen=action-error",
    "kind": "state"
  }
];

export function getScreenDefinition(id: string): ScreenDefinition | undefined {
  return screenManifest.find(screen => screen.id === id);
}
