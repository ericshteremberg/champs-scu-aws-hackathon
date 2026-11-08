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
