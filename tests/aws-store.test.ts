import { describe, expect, it, vi } from 'vitest';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createStore, keys, workspaceIdForUser } from '../aws/store.ts';
import { ConflictError } from '../aws/types.ts';

const fakeClient = (send: ReturnType<typeof vi.fn>) => ({ send }) as unknown as DynamoDBDocumentClient;
const item = (id: string, version = 1) => ({ pk: 'ws', sk: `case#${id}`, version, data: { id } });

describe('native DynamoDB store boundaries', () => {
  it('hashes the owner into a stable isolated workspace key', () => {
    expect(workspaceIdForUser('owner')).toBe(workspaceIdForUser('owner'));
    expect(workspaceIdForUser('owner')).not.toBe(workspaceIdForUser('other'));
    expect(workspaceIdForUser('owner')).not.toContain('owner');
  });

  it('strongly reads one exact tenant key and queries only a case evidence prefix', async () => {
    const send = vi.fn().mockResolvedValueOnce({ Item: item('one', 4) }).mockResolvedValueOnce({ Items: [] });
    const store = createStore(fakeClient(send), 'cases-table');
    expect(await store.getItem('ws', keys.case('one'))).toEqual({ key: 'case#one', version: 4, data: { id: 'one' } });
    await store.queryItems('ws', keys.evidencePrefix('one'));
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({ Key: { pk: 'ws', sk: 'case#one' }, ConsistentRead: true });
    expect(send.mock.calls[1][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[1][0].input).toMatchObject({ ConsistentRead: true, ExpressionAttributeValues: { ':pk': 'ws', ':prefix': 'evidence#one#' } });
  });

  it('follows every page, permits an exact bound, and rejects additional records', async () => {
    const send = vi.fn().mockResolvedValueOnce({ Items: [item('a'), item('b')], LastEvaluatedKey: { pk: 'ws', sk: 'case#b' } }).mockResolvedValueOnce({ Items: [] });
    expect((await createStore(fakeClient(send), 'table').queryItems('ws', 'case#', { maxItems: 2 })).length).toBe(2);
    expect(send.mock.calls[1][0].input).toMatchObject({ Limit: 1, ExclusiveStartKey: { pk: 'ws', sk: 'case#b' } });
    const excessive = vi.fn().mockResolvedValue({ Items: [item('a'), item('b'), item('c')] });
    await expect(createStore(fakeClient(excessive), 'table').queryItems('ws', 'case#', { maxItems: 2 })).rejects.toMatchObject({ code: 'query_limit' });
  });

  it('writes a single atomic transaction with absent and version conditions for every item', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = createStore(fakeClient(send), 'table');
    await store.commit('ws', [
      { key: keys.case('a'), expectedVersion: 2, data: { id: 'a' } },
      { key: keys.draft('a'), expectedVersion: null, data: { content: 'Reviewed' } },
      { key: keys.run('r'), expectedVersion: 3, check: true },
      { key: keys.upload('u'), expectedVersion: 1, delete: true },
    ]);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toMatchObject([
      { Put: { Item: { pk: 'ws', sk: 'case#a', version: 3 }, ConditionExpression: '#version = :expected', ExpressionAttributeValues: { ':expected': 2 } } },
      { Put: { Item: { pk: 'ws', sk: 'draft#a', version: 1 }, ConditionExpression: 'attribute_not_exists(#pk)' } },
      { ConditionCheck: { Key: { pk: 'ws', sk: 'run#r' }, ExpressionAttributeValues: { ':expected': 3 } } },
      { Delete: { Key: { pk: 'ws', sk: 'upload#u' }, ExpressionAttributeValues: { ':expected': 1 } } },
    ]);
  });

  it('recognizes lost-update conflicts without disguising service errors as conflicts', async () => {
    const send = vi.fn().mockRejectedValueOnce({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] }).mockRejectedValueOnce(new Error('Service unavailable'));
    const store = createStore(fakeClient(send), 'table');
    await expect(store.commit('ws', [{ key: 'case#a', expectedVersion: 1, data: {} }])).rejects.toBeInstanceOf(ConflictError);
    await expect(store.commit('ws', [{ key: 'case#a', expectedVersion: 1, data: {} }])).rejects.toThrow('Service unavailable');
  });

  it('rejects oversized or duplicate-item transactions before any AWS write', async () => {
    const send = vi.fn(); const store = createStore(fakeClient(send), 'table');
    await expect(store.commit('ws', [{ key: 'case#a', expectedVersion: null, data: { body: 'x'.repeat(300 * 1024) } }])).rejects.toMatchObject({ code: 'record_too_large' });
    await expect(store.commit('ws', [{ key: 'a', expectedVersion: 1, check: true }, { key: 'a', expectedVersion: 1, data: {} }])).rejects.toThrow('Invalid workspace transaction');
    await expect(store.commit('ws', Array.from({ length: 101 }, (_, index) => ({ key: String(index), expectedVersion: null, data: {} })))).rejects.toThrow('Invalid workspace transaction');
    expect(send).not.toHaveBeenCalled();
  });

  it('makes pending-upload expiry available to the DynamoDB TTL service', async () => {
    const send = vi.fn().mockResolvedValue({});
    await createStore(fakeClient(send), 'table').commit('ws', [{ key: keys.upload('u'), expectedVersion: null, data: { ttlEpochSeconds: 1900000000 } }]);
    expect(send.mock.calls[0][0].input.TransactItems[0].Put.Item.ttlEpochSeconds).toBe(1900000000);
  });
});
