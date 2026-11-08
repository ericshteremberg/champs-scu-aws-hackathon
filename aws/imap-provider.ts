import { discoverImap, discoveryEmail } from './imap-discovery.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { commit, getItem, keys } from './store.ts';
import { ApiError, type StoreChange, type TrustedUser, type EvidenceDoc } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';
import { imapSettingsSchema, imapMessageId, verifyImap, searchImap, previewImap, type ImapSettings } from './imap-api.ts';
import type { ImapConnection, ImapPreview } from '../lib/providers/types.ts';

const connectionKey = 'provider#imap', tokenKey = 'provider-token#imap';
type InternalConnection = ImapConnection & { attemptedAt?: number };
type Selection = { caseVersion: number; connectionVersion: number; ids: string[]; ttlEpochSeconds: number };
type Preview = { caseVersion: number; connectionVersion: number; message: ImapPreview; ttlEpochSeconds: number };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const caseId = z.string().min(1).max(200);
const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('discover'), email: discoveryEmail }).strict(),
  z.object({ action: z.literal('connect'), settings: imapSettingsSchema, confirmed: z.literal(true), detectSent: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
  z.object({ action: z.literal('search'), caseId, topic: z.literal('policy').optional(), scope: z.enum(['recent', 'all']).optional() }).strict(),
  z.object({ action: z.literal('preview'), caseId, messageId: imapMessageId }).strict(),
  z.object({ action: z.literal('import'), caseId, messageId: imapMessageId, confirmed: z.literal(true) }).strict(),
]);
export async function imapProviderStatus(wid: string) {
  const row = await getItem<InternalConnection>(wid, connectionKey);
  const connection: ImapConnection | null = row ? { status: row.data.status, updatedAt: row.data.updatedAt, ...(row.data.email ? { email: row.data.email } : {}), ...(row.data.host ? { host: row.data.host } : {}), ...(row.data.folders ? { folders: row.data.folders } : {}) } : null;
  return { configured: true, connection };
}
async function connect(user: TrustedUser, wid: string, settings: ImapSettings, detectSent: boolean) {
  const [existing, token] = await Promise.all([getItem<InternalConnection>(wid, connectionKey), getItem<ImapSettings>(wid, tokenKey)]);
  if ((existing && existing.data.status !== 'disconnected') || token) throw new ApiError(409, 'Disconnect the existing IMAP mailbox before connecting again.', 'provider_already_connected');
  if (existing?.data.attemptedAt && Date.now() - existing.data.attemptedAt < 30000) throw new ApiError(429, 'Wait 30 seconds before testing another mailbox login.', 'imap_rate_limited');
  // Reserve a version before network I/O. Disconnect invalidates in-flight connects.
  await commit(wid, [{ key: connectionKey, expectedVersion: existing?.version ?? null, data: { status: 'disconnected', updatedAt: now(), attemptedAt: Date.now() } satisfies InternalConnection }]);
  const folders = await verifyImap(settings, detectSent);
  settings = imapSettingsSchema.parse({ ...settings, folders });
  const connection: ImapConnection = { status: 'authorized', updatedAt: now(), email: settings.email, host: settings.host, folders: settings.folders };
  await commit(wid, [
    { key: connectionKey, expectedVersion: (existing?.version ?? 0) + 1, data: connection },
    { key: tokenKey, expectedVersion: null, data: settings },
    auditChange(user, 'provider.imap_connected', 'Verified an IMAP mailbox with read-only folder access. No email content imported.'),
  ]);
  return { connection };
}
async function access(wid: string) {
  const [connection, token] = await Promise.all([getItem<ImapConnection>(wid, connectionKey), getItem<ImapSettings>(wid, tokenKey)]);
  if (!connection || connection.data.status !== 'authorized' || !token) throw new ApiError(409, 'Connect an IMAP mailbox to continue.', 'provider_disconnected');
  if (connection.data.email !== token.data.email || connection.data.host !== token.data.host || JSON.stringify(connection.data.folders) !== JSON.stringify(token.data.folders)) throw new ApiError(409, 'The mailbox settings changed. Disconnect and connect again.', 'provider_account_mismatch');
  return { connection, token };
}
async function disconnect(user: TrustedUser, wid: string) {
  const [connection, token] = await Promise.all([getItem<InternalConnection>(wid, connectionKey), getItem<ImapSettings>(wid, tokenKey)]);
  const data: InternalConnection = { status: 'disconnected', updatedAt: now(), ...(connection?.data.attemptedAt ? { attemptedAt: connection.data.attemptedAt } : {}) };
  const changes: StoreChange[] = [{ key: connectionKey, expectedVersion: connection?.version ?? null, data }, auditChange(user, 'provider.imap_disconnected', 'Removed saved IMAP credentials. Imported evidence remains on its case. Revoke any app password with the mail provider separately.')];
  if (token) changes.push({ key: tokenKey, expectedVersion: token.version, delete: true });
  await commit(wid, changes);
  return { connection: { status: data.status, updatedAt: data.updatedAt } };
}
export async function imapProviderAction(user: TrustedUser, input: unknown) {
  const parsed = actions.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a valid IMAP connection action.', 'invalid_request');
  const action = parsed.data; const wid = (await requireWorkspace(user)).data.id;
  if (action.action === 'discover') return { discovery: await discoverImap(action.email) };
  if (action.action === 'connect') return connect(user, wid, action.settings, action.detectSent ?? false);
  if (action.action === 'disconnect') return disconnect(user, wid);
  const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
  const { connection, token } = await access(wid);
  const guard: StoreChange[] = [{ key: connectionKey, expectedVersion: connection.version, check: true }, { key: tokenKey, expectedVersion: token.version, check: true }];
  const selectionKey = `imap-selection#${row.data.id}`, previewKey = `imap-preview#${row.data.id}`;
  try {
    if (action.action === 'search') {
      const results = await (action.topic ? searchImap(token.data, row.data.email, action.scope ?? 'recent', action.topic) : searchImap(token.data, row.data.email, action.scope ?? 'recent'));
      const prior = await getItem<Selection>(wid, selectionKey);
      await commit(wid, [...guard, { key: row.key, expectedVersion: row.version, check: true }, { key: selectionKey, expectedVersion: prior?.version ?? null, data: { caseVersion: row.version, connectionVersion: connection.version, ids: results.messages.map(m => m.id), ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Selection }, auditChange(user, 'provider.imap_searched', 'Searched up to ten messages involving the case customer email. Message bodies were not saved.', row.data.id)]);
      return { ...results, searchedEmail: row.data.email, scope: action.scope ?? 'recent', folders: token.data.folders };
    }
    if (action.action === 'preview') {
      const selection = await getItem<Selection>(wid, selectionKey);
      if (!selection || selection.data.caseVersion !== row.version || selection.data.connectionVersion !== connection.version || selection.data.ttlEpochSeconds <= Date.now() / 1000 || !selection.data.ids.includes(action.messageId)) throw new ApiError(409, 'Search this case again before previewing an email.', 'imap_selection_expired');
      const message = await previewImap(token.data, action.messageId);
      const prior = await getItem<Preview>(wid, previewKey);
      await commit(wid, [...guard, { key: row.key, expectedVersion: row.version, check: true }, { key: selection.key, expectedVersion: selection.version, check: true }, { key: previewKey, expectedVersion: prior?.version ?? null, data: { caseVersion: row.version, connectionVersion: connection.version, message, ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Preview }]);
      return { preview: message };
    }
    const preview = await getItem<Preview>(wid, previewKey);
    if (!preview || preview.data.caseVersion !== row.version || preview.data.connectionVersion !== connection.version || preview.data.ttlEpochSeconds <= Date.now() / 1000 || preview.data.message.id !== action.messageId) throw new ApiError(409, 'Preview this email again before importing it.', 'imap_preview_expired');
    const [records, draft] = await Promise.all([listEvidence(wid, row.data.id), getDraft(wid, row.data.id)]);
    const id = `imap_${hash(`${token.data.host}:${token.data.email.toLowerCase()}:${action.messageId}`).slice(0, 40)}`;
    if (records.some(r => r.data.id === id)) throw new ApiError(409, 'This email is already evidence on this case.', 'imap_already_imported');
    if (records.length >= MAX_CASE_EVIDENCE) throw new ApiError(409, 'This case has reached its evidence limit.');
    const m = preview.data.message;
    const content = `Mailbox: ${token.data.email}\nIMAP message: ${m.id}\nIMAP folder: ${m.folder}\nFrom: ${m.from}\nTo: ${m.to}\nSubject: ${m.subject}\nDate: ${m.occurredAt}\nFormat: plain text only; attachments excluded${m.truncated ? '; excerpt truncated at 20,000 characters' : ''}\n\n${m.text}`;
    const changes: StoreChange[] = [...guard, { key: preview.key, expectedVersion: preview.version, delete: true }, caseChange(row, { ...row.data, status: 'needs_review', dataRevision: row.data.dataRevision + 1, updatedAt: now() }), { key: keys.evidence(row.data.id, id), expectedVersion: null, data: { id, caseId: row.data.id, source: 'imap', reference: `imap:${m.id}`, title: (m.subject || 'Customer email').slice(0, 200), content, occurredAt: m.occurredAt, createdAt: now() } satisfies EvidenceDoc }, auditChange(user, 'provider.imap_imported', 'Imported a reviewed IMAP plain-text message. Prior draft approval cleared; no email was sent or changed.', row.data.id)];
    if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
    await commit(wid, changes);
    return { imported: true, caseId: row.data.id, evidenceId: id };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'imap_auth_failed') await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data: { ...connection.data, status: 'reconnect_required', updatedAt: now() } }, { key: tokenKey, expectedVersion: token.version, check: true }]).catch(() => undefined);
    throw e;
  }
}
