import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { commit, getItem } from './store.ts';
import { ApiError, type Stored, type StoreChange, type TrustedUser } from './types.ts';
import { auditChange, requireWorkspace } from './workspace.ts';
import { exchangeSupabaseToken, fetchSupabaseProjects, fetchSupabaseSchema, frontendOrigin, loadSupabaseApp, projectRef, revokeSupabaseToken, tableSelection, type SupabaseTokens } from './supabase-api.ts';
import type { ProviderStatus, SchemaTable, SupabaseConnection } from '../lib/providers/types.ts';
import { imapProviderStatus } from './imap-provider.ts';
import { gmailProviderStatus } from './gmail-provider.ts';
import { stripeProviderStatus } from './stripe-provider.ts';

const connectionKey = 'provider#supabase';
const tokenKey = 'provider-token#supabase';
const pendingKey = 'provider-oauth#supabase';
type Pending = { stateHash: string; bindingHash: string; verifier: string; userId: string; connectionVersion: number; ttlEpochSeconds: number };
type Tokens = SupabaseTokens & { refreshing?: boolean };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const same = (s: string, digest: string) => digest.length === 64 && timingSafeEqual(Buffer.from(hash(s), 'hex'), Buffer.from(digest, 'hex'));
const browserBinding = z.string().regex(/^[a-f0-9]{64}$/);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('projects') }).strict(),
  z.object({ action: z.literal('select_project'), projectRef }).strict(),
  z.object({ action: z.literal('schema') }).strict(),
  z.object({ action: z.literal('approve_tables'), tables: tableSelection }).strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
]);

// Explicit public projection. Tokens and pending PKCE/state records never enter workspace responses.
function publicConnection(row: Stored<SupabaseConnection> | null): SupabaseConnection | null {
  if (!row) return null;
  const { status, updatedAt, project, approvedTables, revocationPending } = row.data;
  return { status, updatedAt, ...(project ? { project: { ref: project.ref, name: project.name, organization: project.organization, region: project.region } } : {}), ...(approvedTables ? { approvedTables: approvedTables.map(t => ({ name: t.name, columns: [...t.columns] })) } : {}), ...(revocationPending ? { revocationPending: true } : {}) };
}

export async function providerStatus(user: TrustedUser): Promise<ProviderStatus> {
  const wid = (await requireWorkspace(user)).data.id;
  const [supabase, stripe, gmail, imap] = await Promise.all([getItem<SupabaseConnection>(wid, connectionKey), stripeProviderStatus(wid), gmailProviderStatus(wid), imapProviderStatus(wid)]);
  return { supabase: { configured: !!process.env.SUPABASE_OAUTH_SECRET_ARN, connection: publicConnection(supabase) }, stripe, gmail, imap };
}

export async function startSupabase(user: TrustedUser, binding: string | undefined) {
  if (!browserBinding.safeParse(binding).success) throw new ApiError(400, 'Start authorization from the Connections page.', 'oauth_browser_required');
  const wid = (await requireWorkspace(user)).data.id;
  const app = await loadSupabaseApp();
  const [connection, pending, oldToken] = await Promise.all([getItem<SupabaseConnection>(wid, connectionKey), getItem<Pending>(wid, pendingKey), getItem<Tokens>(wid, tokenKey)]);
  if ((connection && connection.data.status !== 'disconnected') || oldToken) throw new ApiError(409, 'Disconnect the existing Supabase authorization before connecting again.', 'provider_already_connected');
  const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(32).toString('base64url');
  const version = connection?.version ?? 1;
  await commit(wid, [
    connection ? { key: connectionKey, expectedVersion: connection.version, check: true } : { key: connectionKey, expectedVersion: null, data: { status: 'disconnected', updatedAt: new Date().toISOString() } satisfies SupabaseConnection },
    { key: pendingKey, expectedVersion: pending?.version ?? null, data: { stateHash: hash(state), bindingHash: hash(binding!), verifier, userId: user.userId, connectionVersion: version, ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Pending },
  ]);
  const url = new URL('https://api.supabase.com/v1/oauth/authorize');
  url.search = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, response_type: 'code', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { authorizationUrl: url.toString() };
}

export async function finishSupabase(user: TrustedUser, url: URL, binding: string | undefined): Promise<string> {
  const redirect = (result: string) => `${frontendOrigin()}/workspace?view=integrations&provider_result=${result}`;
  const wid = (await requireWorkspace(user)).data.id;
  const [pending, connection] = await Promise.all([getItem<Pending>(wid, pendingKey), getItem<SupabaseConnection>(wid, connectionKey)]);
  const state = url.searchParams.get('state') || '';
  if (!browserBinding.safeParse(binding).success || !pending || !connection || state.length > 200 || !same(state, pending.data.stateHash) || !same(binding!, pending.data.bindingHash) || pending.data.userId !== user.userId || pending.data.ttlEpochSeconds <= Date.now() / 1000 || pending.data.connectionVersion !== connection.version) return redirect('invalid_state');
  try {
    // Consume before making an external request. A retry must start a fresh flow.
    await commit(wid, [{ key: pendingKey, expectedVersion: pending.version, delete: true }, { key: connectionKey, expectedVersion: connection.version, check: true }]);
  } catch { return redirect('invalid_state'); }
  if (url.searchParams.has('error')) return redirect('denied');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) return redirect('failed');
  try {
    const app = await loadSupabaseApp();
    const tokens = await exchangeSupabaseToken(app, { grant_type: 'authorization_code', code, redirect_uri: app.redirectUri, code_verifier: pending.data.verifier });
    try {
      await commit(wid, [
        { key: connectionKey, expectedVersion: connection.version, data: { status: 'authorized', updatedAt: new Date().toISOString() } satisfies SupabaseConnection },
        { key: tokenKey, expectedVersion: null, data: tokens },
        auditChange(user, 'provider.supabase_authorized', 'Authorized Supabase read access. Project selection and evidence scope review are still required.'),
      ]);
    } catch {
      // A disconnect or another authorization won the race. Never restore its connection.
      await revokeSupabaseToken(app, tokens.refreshToken).catch(() => undefined);
      return redirect('failed');
    }
    return redirect('authorized');
  } catch { return redirect('failed'); }
}

async function active(wid: string) {
  const connection = await getItem<SupabaseConnection>(wid, connectionKey);
  const token = await getItem<Tokens>(wid, tokenKey);
  if (!connection || connection.data.status !== 'authorized' || !token) throw new ApiError(409, 'Authorize Supabase to continue.', 'provider_disconnected');
  return { connection, token };
}

async function access(wid: string) {
  const loaded = await active(wid);
  if (loaded.token.data.refreshing) throw new ApiError(409, 'Authorization refresh is in progress. If it does not finish, disconnect and authorize again.', 'provider_refresh_busy');
  if (loaded.token.data.expiresAt > Date.now() + 60_000) return loaded;
  const app = await loadSupabaseApp();
  await commit(wid, [
    { key: connectionKey, expectedVersion: loaded.connection.version, check: true },
    { key: tokenKey, expectedVersion: loaded.token.version, data: { ...loaded.token.data, refreshing: true } },
  ]);
  let fresh: SupabaseTokens;
  try { fresh = await exchangeSupabaseToken(app, { grant_type: 'refresh_token', refresh_token: loaded.token.data.refreshToken }); }
  catch (error) {
    // The provider may have rotated a token even if its response was lost. Do not retry it blindly.
    await commit(wid, [
      { key: connectionKey, expectedVersion: loaded.connection.version, data: { ...loaded.connection.data, status: 'reconnect_required', updatedAt: new Date().toISOString() } },
      { key: tokenKey, expectedVersion: loaded.token.version + 1, data: { ...loaded.token.data, refreshing: false } },
    ]).catch(() => undefined);
    throw error;
  }
  try {
    await commit(wid, [{ key: connectionKey, expectedVersion: loaded.connection.version, check: true }, { key: tokenKey, expectedVersion: loaded.token.version + 1, data: fresh }]);
  } catch (error) { await revokeSupabaseToken(app, fresh.refreshToken).catch(() => undefined); throw error; }
  return { connection: loaded.connection, token: { key: tokenKey, version: loaded.token.version + 2, data: fresh } };
}

async function disconnect(user: TrustedUser, wid: string) {
  const [connection, token, pending] = await Promise.all([getItem<SupabaseConnection>(wid, connectionKey), getItem<Tokens>(wid, tokenKey), getItem<Pending>(wid, pendingKey)]);
  if (!connection) return { connection: null };
  const data: SupabaseConnection = { status: 'disconnected', updatedAt: new Date().toISOString(), revocationPending: !!token };
  const changes: StoreChange[] = [{ key: connectionKey, expectedVersion: connection.version, data }, auditChange(user, 'provider.supabase_disconnected', 'Disabled Supabase access in Causality and cleared the selected project and evidence scope.')];
  if (pending) changes.push({ key: pendingKey, expectedVersion: pending.version, delete: true });
  // Retain a private token only for revocation retry. Status blocks all reads immediately.
  if (token) changes.push({ key: tokenKey, expectedVersion: token.version, data: { ...token.data, refreshing: false } });
  await commit(wid, changes);
  if (token) {
    try {
      await revokeSupabaseToken(await loadSupabaseApp(), token.data.refreshToken);
      data.revocationPending = false;
      await commit(wid, [{ key: connectionKey, expectedVersion: connection.version + 1, data }, { key: tokenKey, expectedVersion: token.version + 1, delete: true }]);
    } catch { return { connection: { ...data, revocationPending: true } }; }
  }
  return { connection: data };
}

export async function supabaseAction(user: TrustedUser, input: unknown) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a valid Supabase connection action.', 'invalid_request');
  const wid = (await requireWorkspace(user)).data.id; const action = parsed.data;
  if (action.action === 'disconnect') return disconnect(user, wid);
  const { connection, token } = await access(wid);
  const assertCurrent = () => commit(wid, [{ key: connectionKey, expectedVersion: connection.version, check: true }, { key: tokenKey, expectedVersion: token.version, check: true }]);
  try {
    if (action.action === 'projects' || action.action === 'select_project') {
      const projects = await fetchSupabaseProjects(token.data.accessToken);
      if (action.action === 'projects') { await assertCurrent(); return { projects }; }
      const project = projects.find(p => p.ref === action.projectRef);
      if (!project) throw new ApiError(403, 'This project is not available to the authorized Supabase account.', 'provider_project_denied');
      const data: SupabaseConnection = { status: 'authorized', updatedAt: new Date().toISOString(), project };
      await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data }, { key: tokenKey, expectedVersion: token.version, check: true }, auditChange(user, 'provider.supabase_project_selected', 'Selected a project from the authorized Supabase account. Prior evidence scope approval was cleared.')]);
      return { connection: data };
    }
    if (!connection.data.project) throw new ApiError(409, 'Select a Supabase project first.', 'provider_project_required');
    const schema = await fetchSupabaseSchema(token.data.accessToken, connection.data.project.ref);
    if (action.action === 'schema') { await assertCurrent(); return { schema, schemaName: 'public' }; }
    const approved: SchemaTable[] = [];
    for (const table of action.tables) {
      const actual = schema.find(t => t.name === table.name);
      if (!actual || approved.some(t => t.name === table.name) || new Set(table.columns).size !== table.columns.length || table.columns.some(c => !actual.columns.includes(c))) throw new ApiError(400, 'The selected tables or columns changed. Reload the schema and review them again.', 'provider_mapping_changed');
      approved.push({ name: table.name, columns: [...table.columns] });
    }
    const data = { ...connection.data, approvedTables: approved, updatedAt: new Date().toISOString() };
    await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data }, { key: tokenKey, expectedVersion: token.version, check: true }, auditChange(user, 'provider.supabase_scope_approved', 'Approved table and column scope. No customer rows were queried; verified payment and case mapping remain required.')]);
    return { connection: data };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'provider_reauthorize') {
      await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data: { ...connection.data, status: 'reconnect_required', updatedAt: new Date().toISOString() } }, { key: tokenKey, expectedVersion: token.version, check: true }]).catch(() => undefined);
    }
    throw error;
  }
}
