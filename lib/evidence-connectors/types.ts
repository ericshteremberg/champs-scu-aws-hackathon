import type { EvidenceEnvelope, EvidenceMode, EvidenceSection } from '../investigation/types.ts';

export interface OrderMapping {
  table: string;
  id: string;
  merchantId: string;
  orderRef: string;
  paymentRef: string;
  amount: string;
  currency: string;
  purchasedAt: string;
}

export interface SectionMapping {
  table: string;
  id: string;
  orderId: string;
  merchantId: string;
  occurredAt: string;
  title: string;
  detail: string;
  fields: Record<string, string>;
  limit: number;
}

export interface ConnectorManifest {
  version: 1;
  id: string;
  name: string;
  businessType: 'tickets' | 'rentals';
  schema: string;
  order: OrderMapping;
  sections: Partial<Record<Exclude<EvidenceSection, 'summary' | 'order'>, SectionMapping>>;
}

export interface ConnectorCase {
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
  sourceMode: EvidenceMode;
  summary: string;
  orderRef: string;
  paymentRef: string;
  tags: string[];
}

/** Created by the merchant from an independently verified dispute/payment/order link. */
export interface ConnectorGrant {
  /** At most 64 characters, so stable source-based evidence ids fit the wire contract. */
  caseId: string;
  merchantId: string;
  orderId: string;
  orderRef: string;
  paymentRef: string;
  expiresAt: string;
  revoked: boolean;
  case: ConnectorCase;
}

export interface ConnectorReadPlan {
  section: EvidenceSection;
  sql: string;
  params: string[];
  limit: number;
  table: string;
  columns: string[];
}

export interface ConnectorSchemaTable {
  name: string;
  columns: string[];
}

export interface ConnectorTemplate {
  id: 'atmsphr-tickets' | 'rentul-rentals';
  name: string;
  description: string;
  fixtureLabel: string;
  manifest: ConnectorManifest;
  schema: ConnectorSchemaTable[];
  exampleCaseId: string;
}

export interface ConnectorPreview {
  sourceMode: 'synthetic';
  templateId: string;
  case: ConnectorCase;
  sections: EvidenceEnvelope[];
  recordCount: number;
  readPlans: ConnectorReadPlan[];
  checks: { name: string; passed: boolean; detail: string }[];
  deniedCaseId: string;
  limitations: string[];
}
