import type { ConverseCommandInput, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import type { DisputeCase, Finding } from '../domain.ts';

export const EVIDENCE_SECTIONS = ['summary', 'order', 'tickets', 'delivery', 'history', 'support', 'attendance', 'policy'] as const;
export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];
export type EvidenceMode = 'live' | 'attached' | 'anonymized_snapshot' | 'synthetic';
export type InvestigationMode = 'sample' | 'bedrock';

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
  sourceMode: EvidenceMode;
  fetchedAt: string;
  status: 'available' | 'partial' | 'unavailable';
  records: EvidenceRecord[];
  limitations: string[];
}

export interface InvestigationEvent {
  id: string;
  at: string;
  type: 'started' | 'tool_requested' | 'tool_completed' | 'model_requested' | 'model_completed' | 'blocked' | 'completed';
  title: string;
  detail: string;
  section?: EvidenceSection;
  evidenceIds?: string[];
  latencyMs?: number;
}

export interface InvestigationResult {
  content: string;
  findings: Finding[];
  summary: string;
  assessment: 'supported' | 'mixed' | 'insufficient';
  recommendation: string;
  gaps: string[];
  evidenceIds: string[];
  modelId?: string;
  metrics: { durationMs: number; toolCalls: number; recordCount: number; modelCalls: number };
}

export interface InvestigationCredentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

export interface InvestigationInput {
  case: Pick<DisputeCase, 'id' | 'title' | 'reason' | 'orderRef' | 'amount' | 'currency' | 'source'>;
  mode: InvestigationMode;
  modelId?: string;
  region: string;
  credentials?: InvestigationCredentials;
  signal: AbortSignal;
  readEvidence: (section: EvidenceSection, signal: AbortSignal) => Promise<EvidenceEnvelope>;
  assertActive: () => Promise<void>;
  onEvent: (event: InvestigationEvent) => Promise<void>;
  /** Dependency injection for deterministic tests. Never accept this from a request body. */
  invokeModel?: (input: ConverseCommandInput, signal: AbortSignal) => Promise<ConverseCommandOutput>;
}

export class InvestigationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'InvestigationError'; this.code = code; }
}
