import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { ApiError, ConflictError, type Stored, type StoreChange } from './types.ts';
export type { Stored, StoreChange } from './types.ts';

export const keys = {
  workspace: 'meta',
  case: (id: string) => `case#${id}`,
  evidence: (caseId: string, id: string) => `evidence#${caseId}#${id}`,
  evidencePrefix: (caseId: string) => `evidence#${caseId}#`,
  draft: (caseId: string) => `draft#${caseId}`,
  run: (runId: string) => `run#${runId}`,
  event: (runId: string, sequence: number | string) => `event#${runId}#${String(sequence).padStart(6, '0')}`,
  eventPrefix: (runId: string) => `event#${runId}#`,
  policy: (id: string) => `policy#${id}`,
  access: (id: string) => `access#${id}`,
  audit: (timestamp: string, id: string) => `audit#${timestamp}#${id}`,
  stripe: 'integration#stripe',
  stripeEvent: (id: string) => `stripe-event#${id}`,
  externalCase: (id: string) => `merchant-case#${id}`,
  upload: (id: string) => `upload#${id}`,
};
export const workspaceIdForUser = (userId: string) => `ws_${createHash('sha256').update(userId).digest('hex').slice(0, 40)}`;
const MAX_ITEM_BYTES = 300 * 1024;
const MAX_TRANSACTION_BYTES = 3 * 1024 * 1024;

export function createStore(client: DynamoDBDocumentClient, tableName: string) {
  if (!tableName) throw new ApiError(503, 'The AWS workspace database is not configured.', 'database_not_configured');
  const unpack = <T>(value: Record<string, unknown>): Stored<T> => {
    if (typeof value.sk !== 'string' || typeof value.version !== 'number' || !('data' in value)) throw new ApiError(500, 'A stored record could not be read.');
    return { key: value.sk, version: value.version, data: value.data as T };
  };
  return {
    async getItem<T>(workspaceId: string, key: string): Promise<Stored<T> | null> {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: { pk: workspaceId, sk: key }, ConsistentRead: true }));
      return result.Item ? unpack<T>(result.Item) : null;
    },
    async queryItems<T>(workspaceId: string, prefix: string, options: { maxItems?: number } = {}): Promise<Stored<T>[]> {
      const maxItems = options.maxItems ?? 5000;
      if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 10000) throw new ApiError(500, 'Invalid query limit.');
      const records: Stored<T>[] = [];
      let cursor: Record<string, unknown> | undefined;
      let totalBytes = 0;
      do {
        const page = await client.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)', ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' }, ExpressionAttributeValues: { ':pk': workspaceId, ':prefix': prefix }, ConsistentRead: true, ExclusiveStartKey: cursor, Limit: Math.min(500, maxItems + 1 - records.length) }));
        for (const item of page.Items ?? []) {
          totalBytes += Buffer.byteLength(JSON.stringify(item));
          if (records.length >= maxItems || totalBytes > 12 * 1024 * 1024) throw new ApiError(413, 'This workspace exceeds the prototype query limit. Narrow the requested records.', 'query_limit');
          records.push(unpack<T>(item));
        }
        cursor = page.LastEvaluatedKey;
      } while (cursor);
      return records;
    },
    async commit(workspaceId: string, changes: StoreChange[]): Promise<void> {
      if (!changes.length) return;
      if (changes.length > 100 || new Set(changes.map(change => change.key)).size !== changes.length) throw new ApiError(500, 'Invalid workspace transaction.');
      const writes: NonNullable<TransactWriteCommandInput['TransactItems']> = changes.map(change => {
        const expected = change.expectedVersion;
        if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) throw new ApiError(500, 'Invalid expected record version.');
        const condition = expected === null ? 'attribute_not_exists(#pk)' : '#version = :expected';
        const names: Record<string, string> = expected === null ? { '#pk': 'pk' } : { '#version': 'version' };
        const attributes = { ConditionExpression: condition, ExpressionAttributeNames: names, ...(expected === null ? {} : { ExpressionAttributeValues: { ':expected': expected } }) };
        const Key = { pk: workspaceId, sk: change.key };
        if (change.check) return { ConditionCheck: { TableName: tableName, Key, ...attributes } };
        if (change.delete) return { Delete: { TableName: tableName, Key, ...attributes } };
        const ttl = change.data && typeof change.data === 'object' && 'ttlEpochSeconds' in change.data ? change.data.ttlEpochSeconds : undefined;
        if (ttl !== undefined && (!Number.isSafeInteger(ttl) || Number(ttl) <= 0)) throw new ApiError(500, 'Invalid expiry timestamp.');
        const Item = { ...Key, version: (expected ?? 0) + 1, data: change.data, ...(ttl === undefined ? {} : { ttlEpochSeconds: ttl }) };
        if (Buffer.byteLength(JSON.stringify(Item)) > MAX_ITEM_BYTES) throw new ApiError(413, 'An evidence record exceeds the 300 KB database limit. Reduce its permitted fields.', 'record_too_large');
        return { Put: { TableName: tableName, Item, ...attributes } };
      });
      if (Buffer.byteLength(JSON.stringify(writes)) > MAX_TRANSACTION_BYTES) throw new ApiError(413, 'The evidence transaction exceeds the 3 MB prototype limit.', 'transaction_too_large');
      try { await client.send(new TransactWriteCommand({ TransactItems: writes })); }
      catch (error) {
        if (error && typeof error === 'object' && 'name' in error && (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionConflictException' || (error.name === 'TransactionCanceledException' && 'CancellationReasons' in error && Array.isArray(error.CancellationReasons) && error.CancellationReasons.some(reason => reason?.Code === 'ConditionalCheckFailed' || reason?.Code === 'TransactionConflict')))) throw new ConflictError();
        throw error;
      }
    },
  };
}

let activeStore: ReturnType<typeof createStore> | undefined;
function store() {
  if (!activeStore) activeStore = createStore(DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 3 }), { marshallOptions: { removeUndefinedValues: true } }), process.env.CAUSALITY_TABLE || '');
  return activeStore;
}
export function getItem<T>(workspaceId: string, key: string) { return store().getItem<T>(workspaceId, key); }
export function queryItems<T>(workspaceId: string, prefix: string, options?: { maxItems?: number }) { return store().queryItems<T>(workspaceId, prefix, options); }
export function commit(workspaceId: string, changes: StoreChange[]) { return store().commit(workspaceId, changes); }
