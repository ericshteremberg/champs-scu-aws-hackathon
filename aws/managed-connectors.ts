import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ManagedConnection, ManagedConnectorActionResponse, ManagedConnectorListResponse } from '../lib/evidence-connectors/live-types.ts';
import type { MerchantCase } from '../lib/investigation/merchant.ts';
import { validatePublicMerchantUrl, verifyPublicMerchantConnection } from './merchant-network.ts';
import { commit, getItem, queryItems } from './store.ts';
import { ApiError, type Stored, type StoreChange, type TrustedUser } from './types.ts';
import { auditChange, requireWorkspace } from './workspace.ts';

const publicPrefix = 'live-connection#';
const connectionKey = (id: string) => `${publicPrefix}${id}`;
const credentialKey = (id: string) => `connector-credential#${id}`;
// This separate conditional counter makes the limit hold for simultaneous connects.
const quotaKey = 'connector-registry#live';
const MAX_CONNECTIONS = 30;
const connectionId = z.string().regex(/^live_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const tokenSchema = z.string().min(32).max(2048).regex(/^[A-Za-z0-9._~+/-]+=*$/);
const externalCaseId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), name: z.string().trim().min(1).max(100), baseUrl: z.string().min(1).max(2048), token: tokenSchema, externalCaseId }).strict(),
  z.object({ action: z.literal('recheck'), connectionId }).strict(),
  z.object({ action: z.literal('disconnect'), connectionId }).strict(),
]);
const importSchema = z.object({ action: z.literal('import'), connectionId }).strict();
const date = z.string().datetime({ offset: true });
const connectionSchema = z.object({
  id: connectionId, name: z.string().min(1).max(100), baseUrl: z.string().min(1).max(2048), externalCaseId,
  merchantName: z.string().min(1).max(200), merchantId: z.string().min(1).max(200),
  orderRef: z.string().min(1).max(200), paymentRef: z.string().min(1).max(200),
  status: z.enum(['connected', 'disconnected']), verifiedAt: date, createdAt: date, updatedAt: date,
});
type Credential = { token: string };

/** Parsing projects only allowlisted public fields, even if stored records gain fields later. */
function publicConnection(value: unknown): ManagedConnection {
  const parsed = connectionSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(500, 'The saved connection could not be read.', 'invalid_connection_record');
  return parsed.data;
}

export function parseLiveImport(input: unknown) {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a valid connection to import.', 'invalid_request');
  return parsed.data;
}

async function ownedConnection(wid: string, id: string): Promise<Stored<ManagedConnection>> {
  if (!connectionId.safeParse(id).success) throw new ApiError(400, 'Choose a valid live connection.', 'invalid_connection');
  const row = await getItem<ManagedConnection>(wid, connectionKey(id));
  if (!row || row.data.id !== id || row.key !== connectionKey(id)) throw new ApiError(404, 'Live connection not found.', 'connection_not_found');
  return { ...row, data: publicConnection(row.data) };
}

/** Internal only. Callers must never serialize this return value into responses or logs. */
export async function loadManagedConnection(wid: string, id: string): Promise<{
  connection: Stored<ManagedConnection>;
  credential: Stored<Credential>;
  configuration: { baseUrl: string; token: string };
}> {
  const connection = await ownedConnection(wid, id);
  if (connection.data.status !== 'connected') throw new ApiError(409, 'This connection is disconnected. Connect it again to retrieve new evidence.', 'connector_disconnected');
  const credential = await getItem<Credential>(wid, credentialKey(id));
  if (!credential || credential.key !== credentialKey(id) || !tokenSchema.safeParse(credential.data.token).success) throw new ApiError(409, 'The saved credential is unavailable. Create a new connection.', 'connector_credential_missing');
  return { connection, credential: { ...credential, data: { token: credential.data.token } }, configuration: { baseUrl: connection.data.baseUrl, token: credential.data.token } };
}

export async function listManagedConnections(user: TrustedUser): Promise<ManagedConnectorListResponse> {
  const workspace = await requireWorkspace(user);
  const rows = await queryItems<ManagedConnection>(workspace.data.id, publicPrefix, { maxItems: MAX_CONNECTIONS });
  return { connections: rows.map(row => publicConnection(row.data)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), storage: 'aws' };
}

function verificationError(error: unknown): ApiError {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'merchant_configuration': case 'merchant_host_blocked':
      return new ApiError(400, 'Use a public HTTPS evidence API with a valid case-scoped credential.', 'invalid_connector_configuration');
    case 'merchant_access_denied': case 'merchant_not_found':
      return new ApiError(400, 'The evidence API denied access to this case. Check the case ID and its access grant.', 'connector_access_denied');
    case 'merchant_scope_unverified':
      return new ApiError(400, 'The evidence API must deny this credential access to an unrelated case.', 'connector_scope_unverified');
    case 'merchant_timeout': case 'stopped':
      return new ApiError(504, 'Connection verification timed out. Try again when the evidence API is available.', 'connector_timeout');
    case 'invalid_evidence': case 'evidence_scope_mismatch': case 'unverified_case': case 'mapping_mismatch': case 'evidence_too_large':
      return new ApiError(400, 'The evidence API did not return valid, verified evidence for this case.', 'connector_evidence_invalid');
    default:
      return new ApiError(502, 'The evidence API could not be verified. Check its availability and connection settings.', 'connector_verification_failed');
  }
}

async function verify(configuration: { baseUrl: string; token: string }, caseId: string): Promise<MerchantCase> {
  try {
    const result = await verifyPublicMerchantConnection(configuration, caseId, AbortSignal.timeout(20_000));
    if (!result.mappingVerified || !result.case || result.case.id !== caseId || result.case.sourceMode !== 'live') throw new Error('Unverified case');
    return result.case;
  } catch (error) {
    // External responses and errors can contain secrets. Never forward their message.
    throw verificationError(error);
  }
}

export async function executeManagedConnectorAction(user: TrustedUser, input: unknown): Promise<ManagedConnectorActionResponse> {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Check the connection name, HTTPS URL, credential, and case ID.', 'invalid_request');
  const workspace = await requireWorkspace(user); const wid = workspace.data.id; const action = parsed.data;

  if (action.action === 'connect') {
    let baseUrl: string;
    try { baseUrl = validatePublicMerchantUrl(action.baseUrl); } catch (error) { throw verificationError(error); }
    const [rows, quota] = await Promise.all([
      queryItems<ManagedConnection>(wid, publicPrefix, { maxItems: MAX_CONNECTIONS }),
      getItem<{ count: number }>(wid, quotaKey),
    ]);
    const count = Math.max(rows.length, quota?.data.count ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new ApiError(500, 'The connection limit could not be read.', 'invalid_connection_record');
    if (count >= MAX_CONNECTIONS) throw new ApiError(409, 'This workspace supports up to 30 saved live connections.', 'connection_limit');
    const metadata = await verify({ baseUrl, token: action.token }, action.externalCaseId);
    const timestamp = new Date().toISOString();
    const connection = publicConnection({
      id: `live_${randomUUID()}`, name: action.name, baseUrl, externalCaseId: action.externalCaseId,
      merchantName: metadata.merchantName, merchantId: metadata.merchantId, orderRef: metadata.orderRef, paymentRef: metadata.paymentRef,
      status: 'connected', verifiedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    });
    if (JSON.stringify(connection).includes(action.token)) throw new ApiError(400, 'Public connection metadata must not contain its credential.', 'invalid_connector_configuration');
    await commit(wid, [
      { key: connectionKey(connection.id), expectedVersion: null, data: connection },
      // The DynamoDB table encrypts stored items at rest. Only this private record contains the token.
      { key: credentialKey(connection.id), expectedVersion: null, data: { token: action.token } satisfies Credential },
      { key: quotaKey, expectedVersion: quota?.version ?? null, data: { count: count + 1 } },
      auditChange(user, 'connector.live_connected', 'Verified the approved case and passed an unrelated-case rejection smoke check, then saved the live connection. The merchant service must enforce the case grant.'),
    ]);
    return { connection };
  }

  if (action.action === 'recheck') {
    const loaded = await loadManagedConnection(wid, action.connectionId);
    const metadata = await verify(loaded.configuration, loaded.connection.data.externalCaseId);
    const before = loaded.connection.data;
    if (metadata.merchantId !== before.merchantId || metadata.orderRef !== before.orderRef || metadata.paymentRef !== before.paymentRef) throw new ApiError(409, 'This endpoint now identifies a different merchant, order, or payment. Create a new connection after reviewing its access grant.', 'connector_identity_changed');
    const timestamp = new Date().toISOString();
    const connection: ManagedConnection = { ...before, verifiedAt: timestamp, updatedAt: timestamp };
    await commit(wid, [
      { key: loaded.connection.key, expectedVersion: loaded.connection.version, data: connection },
      { key: loaded.credential.key, expectedVersion: loaded.credential.version, check: true },
      auditChange(user, 'connector.live_rechecked', 'Reverified the saved case identity and passed an unrelated-case rejection smoke check. The merchant service must enforce the case grant.'),
    ]);
    return { connection };
  }

  const row = await ownedConnection(wid, action.connectionId);
  const credential = await getItem<Credential>(wid, credentialKey(action.connectionId));
  if (row.data.status === 'disconnected' && !credential) return { connection: row.data };
  const connection: ManagedConnection = { ...row.data, status: 'disconnected', updatedAt: new Date().toISOString() };
  const changes: StoreChange[] = [
    { key: row.key, expectedVersion: row.version, data: connection },
    ...(credential ? [{ key: credential.key, expectedVersion: credential.version, delete: true as const }] : []),
    auditChange(user, 'connector.live_disconnected', 'Disconnected the live connection and removed its saved credential. Previously imported evidence remains available.'),
  ];
  await commit(wid, changes);
  return { connection };
}
