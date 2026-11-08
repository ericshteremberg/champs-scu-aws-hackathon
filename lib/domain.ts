export type CaseStatus = 'needs_review' | 'investigating' | 'ready' | 'submitting' | 'submitted' | 'won' | 'lost';
export type EvidenceSource = 'stripe' | 'gmail' | 'database' | 'policy' | 'manual';
export type Evidence = {
  id: string; caseId: string; source: EvidenceSource; title: string; content: string;
  occurredAt: string; reference: string; fileName?: string; mimeType?: string; downloadUrl?: string;
};
export type Finding = { kind: 'supported' | 'conflict' | 'missing'; title: string; detail: string; evidenceIds: string[] };
export type Draft = { revision: number; content: string; status: 'draft' | 'approved'; generatedAt: string; approvedAt?: string; approvedBy?: string; method: 'evidence_template' };
export type DisputeCase = {
  id: string; title: string; customerName: string; email: string; amount: number; currency: string;
  status: CaseStatus; reason: string; orderRef: string; dueAt: string; source: 'demo' | 'manual' | 'stripe';
  stripeDisputeId?: string; createdAt: string; updatedAt: string; evidence: Evidence[]; findings: Finding[]; draft?: Draft;
};
export type Workspace = { id: string; name: string; industry: string; website: string; onboardingComplete: boolean; retentionDays: number; createdAt: string };
export type Integration = { id: string; provider: 'stripe' | 'gmail' | 'database'; name: string; status: 'connected' | 'not_connected' | 'configuration_required'; mode?: 'test' | 'live'; accountName?: string; lastSyncAt?: string; description: string };
export type Activity = { id: string; action: string; detail: string; actor: string; caseId?: string; createdAt: string };
export type AccessRequest = { id: string; caseId?: string; scope: string; reason: string; status: 'pending' | 'approved' | 'denied'; requestedBy: string; createdAt: string; reviewedBy?: string; canReview: boolean };
export type Policy = { id: string; name: string; content: string; effectiveDate: string; createdAt: string };
export type WorkspaceState = {
  user: { id: string; email: string; name: string }; workspace: Workspace | null; cases: DisputeCase[];
  integrations: Integration[]; activity: Activity[]; accessRequests: AccessRequest[]; policies: Policy[];
};
export type WorkspaceAction =
 | { action: 'createWorkspace'; name: string; industry?: string; website?: string }
 | { action: 'seedDemo' }
 | { action: 'addCase'; title: string; customerName: string; email?: string; amount: number; currency?: string; reason: string; orderRef?: string; dueAt: string }
 | { action: 'updateCase'; caseId: string; status?: 'needs_review' | 'investigating' | 'ready'; title?: string }
 | { action: 'addEvidence'; caseId: string; source: EvidenceSource; title: string; content: string; occurredAt: string; reference?: string }
 | { action: 'generateDraft'; caseId: string }
 | { action: 'saveDraft'; caseId: string; content: string; revision: number }
 | { action: 'approveDraft'; caseId: string; revision: number }
 | { action: 'requestAccess'; caseId?: string; scope: string; reason: string }
 | { action: 'resolveAccess'; requestId: string; decision: 'approved' | 'denied' }
 | { action: 'saveSettings'; name: string; industry?: string; website?: string; retentionDays: number }
 | { action: 'addPolicy'; name: string; content: string; effectiveDate: string }
 | { action: 'removePolicy'; policyId: string };
