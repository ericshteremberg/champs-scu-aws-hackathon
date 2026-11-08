import type { Activity, CaseStatus, DisputeCase, Draft, Evidence, Finding, InvestigationAnalysis, Workspace } from '../lib/domain.ts';

export type TrustedUser = { userId: string; email: string; displayName: string; fullName?: string | null };
export type WorkspaceDoc = Workspace & { ownerId: string; updatedAt: string };
export type CaseDoc = Omit<DisputeCase, 'evidence' | 'findings' | 'draft' | 'investigation'> & {
  workspaceId: string; dataRevision: number; stripeAccountId?: string | null;
  merchantCaseId?: string | null; merchantId?: string | null; paymentRef?: string | null;
  activeRunId?: string; activeRunExpiresAt?: string; latestRunId?: string;
};
export type EvidenceDoc = Omit<Evidence, 'downloadUrl'> & { fileKey?: string; createdAt: string };
export type DraftDoc = Omit<Draft, 'analysis' | 'sourceStale'> & {
  caseId: string; sourceRevision: number | null;
  analysis?: InvestigationAnalysis & { findings: Finding[] };
};
export type AuditDoc = Activity;
export type Stored<T> = { key: string; version: number; data: T };
export type StoreChange =
  | { key: string; expectedVersion: number | null; data: unknown; delete?: never; check?: never }
  | { key: string; expectedVersion: number; delete: true; data?: never; check?: never }
  | { key: string; expectedVersion: number; check: true; data?: never; delete?: never };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'request_failed') {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code;
  }
}
export class ConflictError extends ApiError {
  constructor(message = 'This record changed. Refresh and try again.') { super(409, message, 'conflict'); this.name = 'ConflictError'; }
}
export const mutableStatuses: CaseStatus[] = ['needs_review', 'investigating', 'ready'];
