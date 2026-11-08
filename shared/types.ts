export const EVIDENCE_SECTIONS = ['summary', 'order', 'tickets', 'delivery', 'history', 'support', 'attendance', 'policy'] as const;
export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];
export type SourceMode = 'live' | 'anonymized_snapshot' | 'synthetic';
export type InvestigationMode = 'demo' | 'bedrock';
export type CaseStatus = 'needs_review' | 'investigating' | 'ready' | 'reviewed';

export interface CaseRecord {
  id: string;
  merchantId: string;
  merchantName: string;
  customerLabel: string;
  claim: string;
  reason: string;
  amount: number;
  currency: string;
  eventName: string;
  purchasedAt: string;
  openedAt: string;
  dueAt: string;
  sourceMode: SourceMode;
  status: CaseStatus;
  summary: string;
  orderRef: string;
  paymentRef: string;
  tags: string[];
  latestRunId?: string;
}

export interface EvidenceRecord {
  id: string;
  source: string;
  sourceId: string;
  occurredAt: string;
  title: string;
  detail: string;
  fields: Record<string, string | number | boolean | null>;
}

export interface EvidenceEnvelope {
  caseId: string;
  section: EvidenceSection;
  sourceMode: SourceMode;
  fetchedAt: string;
  status: 'available' | 'partial' | 'unavailable';
  records: EvidenceRecord[];
  limitations: string[];
}

export interface Finding {
  id: string;
  title: string;
  detail: string;
  stance: 'supports_merchant' | 'supports_customer' | 'neutral' | 'unknown';
  evidenceIds: string[];
}

export interface InvestigationReport {
  caseId: string;
  runId: string;
  summary: string;
  assessment: 'supported' | 'mixed' | 'insufficient';
  recommendation: string;
  findings: Finding[];
  gaps: string[];
  responseDraft: string;
  generatedAt: string;
  evidenceIds: string[];
  metrics: { durationMs: number; toolCalls: number; recordCount: number };
  reviewedAt?: string;
  reviewerNote?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  at: string;
  type: 'started' | 'tool_requested' | 'tool_completed' | 'model_requested' | 'model_completed' | 'finding' | 'completed' | 'blocked' | 'stopped' | 'error';
  title: string;
  detail: string;
  section?: EvidenceSection;
  evidenceIds?: string[];
  latencyMs?: number;
}

export interface InvestigationRun {
  id: string;
  caseId: string;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  mode: InvestigationMode;
  startedAt: string;
  finishedAt?: string;
  events: RunEvent[];
  evidence: EvidenceEnvelope[];
  report?: InvestigationReport;
  error?: string;
}

export interface AppConfig {
  name: string;
  version: string;
  mode: InvestigationMode;
  awsRegion: string;
  modelId?: string;
  merchantConnected: boolean;
  archiveEnabled: boolean;
  authRequired: boolean;
}

export interface ApiError { error: string; code?: string }
