export type SupabaseProject = { ref: string; name: string; organization: string; region: string };
export type SchemaTable = { name: string; columns: string[] };
export type SupabaseConnection = {
  status: 'disconnected' | 'authorized' | 'reconnect_required';
  updatedAt: string;
  project?: SupabaseProject;
  approvedTables?: SchemaTable[];
  revocationPending?: boolean;
};
export type ProviderStatus = {
  imap?: { configured: boolean; connection: ImapConnection | null };
  gmail?: { configured: boolean; connection: GmailConnection | null };
  supabase: { configured: boolean; connection: SupabaseConnection | null };
  stripe: { configured: boolean; connection?: StripeProviderConnection | null; reason?: string };
};
export type StripeProviderConnection = {
  status: 'disconnected' | 'authorized' | 'reconnect_required';
  updatedAt: string;
  accountId?: string;
  mode?: 'live' | 'test';
  lastVerifiedAt?: string;
  chargeReadVerified?: boolean;
  uninstallRequired?: boolean;
};

export type GmailConnection = {
  status: 'disconnected' | 'authorized' | 'reconnect_required';
  updatedAt: string;
  email?: string;
  revocationPending?: boolean;
};
export type GmailMessage = { id: string; threadId: string; subject: string; from: string; to: string; occurredAt: string };
export type GmailPreview = GmailMessage & { text: string; truncated: boolean };

export type ImapConnection = { status: 'disconnected' | 'authorized' | 'reconnect_required'; updatedAt: string; email?: string; host?: string; folders?: string[] };
export type ImapMessage = { id: string; folder: string; subject: string; from: string; to: string; occurredAt: string };
export type ImapPreview = ImapMessage & { text: string; truncated: boolean };

export type StripeDisputeSummary = { id: string; amount: number; currency: string; reason: string; status: string; dueAt: string; createdAt: string };
export type OrderEvidenceMapping = {
  order: { table: string; idColumn: string; paymentColumn: string; paymentKind: 'payment_intent' | 'charge'; customerEmailColumn?: string; columns: string[] };
  related: { section: 'tickets' | 'delivery' | 'history' | 'attendance' | 'support'; table: string; orderColumn: string; columns: string[] }[];
};
export type LinkedEvidenceRecord = { id: string; section: string; table: string; fields: Record<string, string | number | boolean | null> };
export type LinkedEvidencePreview = { id: string; caseId: string; projectRef: string; paymentRef: string; fetchedAt: string; records: LinkedEvidenceRecord[]; limitations: string[] };

export type ImapDiscovery =
  | { kind: 'imap'; provider: string; host: string; source: 'provider_dns' | 'imaps_srv' }
  | { kind: 'oauth'; provider: 'Google' | 'Microsoft' }
  | { kind: 'manual'; reason: 'unknown' | 'unavailable' };

export type CustomerLookupMapping = { table: string; idColumn: string; nameColumn: string; emailColumn: string };
export type CustomerMatch = { id: string; sourceId: string; name: string; email: string };
