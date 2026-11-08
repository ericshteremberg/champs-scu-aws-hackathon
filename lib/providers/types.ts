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
  supabase: { configured: boolean; connection: SupabaseConnection | null };
  stripe: { configured: false; reason: string };
};
