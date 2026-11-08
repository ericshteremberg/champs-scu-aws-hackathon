import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { commit, getItem, keys } from './store.ts';
import { ApiError, type StoreChange, type TrustedUser, type EvidenceDoc } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';
import { frontendOrigin } from './supabase-api.ts';
import { exchangeGmailToken, GMAIL_SCOPE, gmailProfile, loadGmailApp, messageId, previewGmail, revokeGmailToken, searchGmail, type GmailTokens } from './gmail-api.ts';
import type { GmailConnection, GmailPreview } from '../lib/providers/types.ts';

const connectionKey = 'provider#gmail', tokenKey = 'provider-token#gmail', pendingKey = 'provider-oauth#gmail';
type Pending = { stateHash: string; bindingHash: string; verifier: string; userId: string; connectionVersion: number; ttlEpochSeconds: number };
type Tokens = GmailTokens & { refreshing?: boolean };
type Selection = { caseVersion: number; connectionVersion: number; ids: string[]; ttlEpochSeconds: number };
type Preview = { caseVersion: number; connectionVersion: number; message: GmailPreview; ttlEpochSeconds: number };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const same = (s: string, digest: string) => /^[a-f0-9]{64}$/.test(digest) && timingSafeEqual(Buffer.from(hash(s), 'hex'), Buffer.from(digest, 'hex'));
const bindingSchema = z.string().regex(/^[a-f0-9]{64}$/);
const caseId = z.string().min(1).max(200);
const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disconnect') }).strict(),
  z.object({ action: z.literal('search'), caseId, topic: z.literal('policy').optional() }).strict(),
  z.object({ action: z.literal('preview'), caseId, messageId }).strict(),
  z.object({ action: z.literal('import'), caseId, messageId, confirmed: z.literal(true) }).strict(),
]);
export async function gmailProviderStatus(wid: string) {
  const row = await getItem<GmailConnection>(wid, connectionKey);
  const connection: GmailConnection | null = row ? { status: row.data.status, updatedAt: row.data.updatedAt, ...(row.data.email ? { email: row.data.email } : {}), ...(row.data.revocationPending ? { revocationPending: true } : {}) } : null;
  return { configured: !!process.env.GMAIL_OAUTH_SECRET_ARN, connection };
}
export async function startGmailProvider(user: TrustedUser, binding: string | undefined) {
  if (!bindingSchema.safeParse(binding).success) throw new ApiError(400, 'Start authorization from the Connections page.', 'oauth_browser_required');
  const wid = (await requireWorkspace(user)).data.id; const app = await loadGmailApp();
  const [connection, pending, token] = await Promise.all([getItem<GmailConnection>(wid, connectionKey), getItem<Pending>(wid, pendingKey), getItem<Tokens>(wid, tokenKey)]);
  if ((connection && connection.data.status !== 'disconnected') || token) throw new ApiError(409, 'Disconnect or finish revoking the existing Gmail connection first.', 'provider_already_connected');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  await commit(wid, [
    connection ? { key: connectionKey, expectedVersion: connection.version, check: true } : { key: connectionKey, expectedVersion: null, data: { status: 'disconnected', updatedAt: now() } satisfies GmailConnection },
    { key: pendingKey, expectedVersion: pending?.version ?? null, data: { stateHash: hash(state), bindingHash: hash(binding!), verifier, userId: user.userId, connectionVersion: connection?.version ?? 1, ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Pending },
  ]);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, response_type: 'code', scope: GMAIL_SCOPE, state, access_type: 'offline', prompt: 'consent', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { authorizationUrl: url.toString() };
}
export async function finishGmailProvider(user: TrustedUser, url: URL, binding: string | undefined) {
  const redirect = (result: string) => `${frontendOrigin()}/workspace?view=integrations&provider_result=gmail_${result}`;
  const wid = (await requireWorkspace(user)).data.id;
  const [pending, connection] = await Promise.all([getItem<Pending>(wid, pendingKey), getItem<GmailConnection>(wid, connectionKey)]);
  const state = url.searchParams.get('state') || '';
  if (!bindingSchema.safeParse(binding).success || !pending || !connection || state.length > 200 || !same(state, pending.data.stateHash) || !same(binding!, pending.data.bindingHash) || pending.data.userId !== user.userId || pending.data.ttlEpochSeconds <= Date.now() / 1000 || pending.data.connectionVersion !== connection.version) return redirect('invalid_state');
  try { await commit(wid, [{ key: pendingKey, expectedVersion: pending.version, delete: true }, { key: connectionKey, expectedVersion: connection.version, check: true }]); } catch { return redirect('invalid_state'); }
  if (url.searchParams.has('error')) return redirect('denied');
  const code = url.searchParams.get('code'); if (!code || code.length > 4096) return redirect('failed');
  let exchanged: Awaited<ReturnType<typeof exchangeGmailToken>> | undefined;
  try {
    exchanged = await exchangeGmailToken(await loadGmailApp(), { grant_type: 'authorization_code', code, code_verifier: pending.data.verifier });
    const email = await gmailProfile(exchanged.accessToken);
    await commit(wid, [
      { key: connectionKey, expectedVersion: connection.version, data: { status: 'authorized', updatedAt: now(), email } satisfies GmailConnection },
      { key: tokenKey, expectedVersion: null, data: { ...exchanged, email } satisfies GmailTokens },
      auditChange(user, 'provider.gmail_authorized', 'Authorized Gmail read-only access. No email content imported.'),
    ]);
    return redirect('authorized');
  } catch { if (exchanged) await revokeGmailToken(exchanged.refreshToken).catch(() => undefined); return redirect('failed'); }
}
async function access(wid: string) {
  const [connection, token] = await Promise.all([getItem<GmailConnection>(wid, connectionKey), getItem<Tokens>(wid, tokenKey)]);
  if (!connection || connection.data.status !== 'authorized' || !token) throw new ApiError(409, 'Connect Gmail to continue.', 'provider_disconnected');
  if (connection.data.email !== token.data.email) throw new ApiError(409, 'Gmail mailbox binding changed. Disconnect and connect again.', 'provider_account_mismatch');
  if (token.data.refreshing) throw new ApiError(409, 'Gmail authorization is refreshing. If this persists, disconnect and connect again.', 'provider_refresh_busy');
  if (token.data.expiresAt > Date.now() + 60000) return { connection, token };
  const app = await loadGmailApp();
  await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, check: true }, { key: tokenKey, expectedVersion: token.version, data: { ...token.data, refreshing: true } }]);
  try {
    const fresh = await exchangeGmailToken(app, { grant_type: 'refresh_token', refresh_token: token.data.refreshToken });
    const email = await gmailProfile(fresh.accessToken);
    if (email !== token.data.email) throw new ApiError(409, 'Google returned a different mailbox. Disconnect and connect again.', 'provider_account_mismatch');
    const data = { ...fresh, email };
    await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, check: true }, { key: tokenKey, expectedVersion: token.version + 1, data }]);
    return { connection, token: { key: tokenKey, version: token.version + 2, data } };
  } catch (e) {
    await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data: { ...connection.data, status: 'reconnect_required', updatedAt: now() } }, { key: tokenKey, expectedVersion: token.version + 1, data: { ...token.data, refreshing: false } }]).catch(() => undefined);
    throw e;
  }
}
async function disconnect(user: TrustedUser, wid: string) {
  const [connection, token, pending] = await Promise.all([getItem<GmailConnection>(wid, connectionKey), getItem<Tokens>(wid, tokenKey), getItem<Pending>(wid, pendingKey)]);
  if (!connection) return { connection: null };
  const data: GmailConnection = { status: 'disconnected', updatedAt: now(), revocationPending: !!token };
  const changes: StoreChange[] = [{ key: connectionKey, expectedVersion: connection.version, data }, auditChange(user, 'provider.gmail_disconnected', 'Stopped Gmail access. Previously imported case evidence is retained.')];
  if (pending) changes.push({ key: pendingKey, expectedVersion: pending.version, delete: true });
  if (token) changes.push({ key: tokenKey, expectedVersion: token.version, check: true });
  await commit(wid, changes); // Disable reads first, even if Google is unavailable.
  if (!token) return { connection: data };
  try { await revokeGmailToken(token.data.refreshToken); }
  catch { return { connection: data }; }
  const cleared: GmailConnection = { status: 'disconnected', updatedAt: now() };
  await commit(wid, [{ key: connectionKey, expectedVersion: connection.version + 1, data: cleared }, { key: tokenKey, expectedVersion: token.version, delete: true }]);
  return { connection: cleared };
}
export async function gmailProviderAction(user: TrustedUser, input: unknown) {
  const parsed = actions.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a valid Gmail connection action.', 'invalid_request');
  const action = parsed.data; const wid = (await requireWorkspace(user)).data.id;
  if (action.action === 'disconnect') return disconnect(user, wid);
  const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
  const { connection, token } = await access(wid);
  const guard: StoreChange[] = [{ key: connectionKey, expectedVersion: connection.version, check: true }, { key: tokenKey, expectedVersion: token.version, check: true }];
  const selectionKey = `gmail-selection#${row.data.id}`, previewKey = `gmail-preview#${row.data.id}`;
  try {
    if (action.action === 'search') {
      const results = await (action.topic ? searchGmail(token.data.accessToken, row.data.email, action.topic) : searchGmail(token.data.accessToken, row.data.email));
      const prior = await getItem<Selection>(wid, selectionKey);
      await commit(wid, [...guard, { key: row.key, expectedVersion: row.version, check: true }, { key: selectionKey, expectedVersion: prior?.version ?? null, data: { caseVersion: row.version, connectionVersion: connection.version, ids: results.messages.map(m => m.id), ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Selection }, auditChange(user, 'provider.gmail_searched', 'Searched up to ten messages involving the case customer email. Message bodies were not saved.', row.data.id)]);
      return results;
    }
    if (action.action === 'preview') {
      const selection = await getItem<Selection>(wid, selectionKey);
      if (!selection || selection.data.caseVersion !== row.version || selection.data.connectionVersion !== connection.version || selection.data.ttlEpochSeconds <= Date.now() / 1000 || !selection.data.ids.includes(action.messageId)) throw new ApiError(409, 'Search this case again before previewing an email.', 'gmail_selection_expired');
      const message = await previewGmail(token.data.accessToken, action.messageId);
      const prior = await getItem<Preview>(wid, previewKey);
      await commit(wid, [...guard, { key: row.key, expectedVersion: row.version, check: true }, { key: selection.key, expectedVersion: selection.version, check: true }, { key: previewKey, expectedVersion: prior?.version ?? null, data: { caseVersion: row.version, connectionVersion: connection.version, message, ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Preview }]);
      return { preview: message };
    }
    const preview = await getItem<Preview>(wid, previewKey);
    if (!preview || preview.data.caseVersion !== row.version || preview.data.connectionVersion !== connection.version || preview.data.ttlEpochSeconds <= Date.now() / 1000 || preview.data.message.id !== action.messageId) throw new ApiError(409, 'Preview this email again before importing it.', 'gmail_preview_expired');
    const [records, draft] = await Promise.all([listEvidence(wid, row.data.id), getDraft(wid, row.data.id)]);
    const id = `gmail_${hash(`${token.data.email}:${action.messageId}`).slice(0, 40)}`;
    if (records.some(r => r.data.id === id)) throw new ApiError(409, 'This email is already evidence on this case.', 'gmail_already_imported');
    if (records.length >= MAX_CASE_EVIDENCE) throw new ApiError(409, 'This case has reached its evidence limit.');
    const m = preview.data.message;
    const content = `Mailbox: ${token.data.email}\nGmail message: ${m.id}\nGmail thread: ${m.threadId}\nFrom: ${m.from}\nTo: ${m.to}\nSubject: ${m.subject}\nDate: ${m.occurredAt}\nFormat: plain text only; attachments excluded${m.truncated ? '; excerpt truncated at 20,000 characters' : ''}\n\n${m.text}`;
    const changes: StoreChange[] = [...guard, { key: preview.key, expectedVersion: preview.version, delete: true }, caseChange(row, { ...row.data, status: 'needs_review', dataRevision: row.data.dataRevision + 1, updatedAt: now() }), { key: keys.evidence(row.data.id, id), expectedVersion: null, data: { id, caseId: row.data.id, source: 'gmail', reference: `gmail:${m.id}`, title: (m.subject || 'Customer email').slice(0, 200), content, occurredAt: m.occurredAt, createdAt: now() } satisfies EvidenceDoc }, auditChange(user, 'provider.gmail_imported', 'Imported a reviewed Gmail plain-text message. Prior draft approval cleared; no email was sent or changed.', row.data.id)];
    if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
    await commit(wid, changes);
    return { imported: true, caseId: row.data.id, evidenceId: id };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'provider_reauthorize') await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data: { ...connection.data, status: 'reconnect_required', updatedAt: now() } }, { key: tokenKey, expectedVersion: token.version, check: true }]).catch(() => undefined);
    throw e;
  }
}
