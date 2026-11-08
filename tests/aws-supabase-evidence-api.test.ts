import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../aws/supabase-api.ts', async original => ({ ...await original<typeof import('../aws/supabase-api.ts')>(), querySupabaseReadOnly: fixture.query }));
import { evidenceQuery, fetchMappedEvidence, validateOrderMapping } from '../aws/supabase-evidence-api.ts';
import type { OrderEvidenceMapping } from '../lib/providers/types.ts';
const token = 'synthetic_access_private', ref = 'abcdefghijklmnopqrst';
const mapping: OrderEvidenceMapping = { order: { table: 'orders', idColumn: 'id', paymentColumn: 'stripe_pi', paymentKind: 'payment_intent', columns: ['id', 'stripe_pi'] }, related: [{ table: 'tickets', section: 'tickets', orderColumn: 'order_id', columns: ['order_id', 'status'] }] };
const schema = [{ name: 'orders', columns: ['id', 'stripe_pi', 'password', 'qr_payload'] }, { name: 'tickets', columns: ['order_id', 'status'] }];
const order = { id: 'ORDER-1', stripe_pi: 'pi_verified' };
beforeEach(() => { fixture.query.mockReset(); fixture.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([order]).mockResolvedValueOnce([{ order_id: order.id, status: 'delivered' }]); });
describe('approved Supabase evidence queries', () => {
  it('uses parameterized, quoted, schema-qualified SELECTs with hard row limits', async () => {
    expect(validateOrderMapping(mapping, schema, schema)).toEqual(mapping);
    const result = await fetchMappedEvidence(token, ref, mapping, 'pi_verified');
    expect(result.records).toHaveLength(2);
    expect(fixture.query.mock.calls).toEqual([
      [token, ref, 'SELECT "id", "stripe_pi" FROM public."orders" WHERE "stripe_pi"::text = $1 LIMIT 2', ['pi_verified']],
      [token, ref, 'SELECT "id", "stripe_pi" FROM public."orders" WHERE "id"::text = $1 LIMIT 2', ['ORDER-1']],
      [token, ref, 'SELECT "order_id", "status" FROM public."tickets" WHERE "order_id"::text = $1 LIMIT 6', ['ORDER-1']],
    ]);
  });
  it('rejects malicious identifiers, query overrides and unsafe columns before network access', () => {
    for (const bad of [{ ...mapping, query: 'SELECT *' }, { ...mapping, order: { ...mapping.order, table: 'orders; DROP TABLE orders' } }, { ...mapping, order: { ...mapping.order, columns: ['id', 'stripe_pi', 'password'] } }, { ...mapping, order: { ...mapping.order, columns: ['id', 'stripe_pi', 'qr_payload'] } }, { ...mapping, related: [{ ...mapping.related[0], columns: ['status'] }] }]) expect(() => validateOrderMapping(bad, schema, schema)).toThrow();
    expect(() => evidenceQuery('orders', ['id'], 'id; DELETE', 2)).toThrow(); expect(() => evidenceQuery('orders', ['*'], 'id', 2)).toThrow(); expect(() => evidenceQuery('orders', ['id'], 'id', 1000)).toThrow();
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it('rejects missing, multiple and mismatched payment roots before child reads', async () => {
    for (const rows of [[], [order, order], [{ ...order, stripe_pi: 'pi_unrelated' }]]) {
      fixture.query.mockReset().mockResolvedValueOnce(rows);
      await expect(fetchMappedEvidence(token, ref, mapping, 'pi_verified')).rejects.toMatchObject({ code: 'mapping_order_unresolved' }); expect(fixture.query).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects nonunique order IDs across tenants before fetching related records', async () => {
    fixture.query.mockReset().mockResolvedValueOnce([order]).mockResolvedValueOnce([order, { ...order, stripe_pi: 'pi_another' }]);
    await expect(fetchMappedEvidence(token, ref, mapping, 'pi_verified')).rejects.toMatchObject({ code: 'mapping_order_unresolved' }); expect(fixture.query).toHaveBeenCalledTimes(2);
  });
  it('rejects additional fields, JSON, overlong values and access-token echoes', async () => {
    for (const row of [{ ...order, extra: 'private' }, { ...order, id: { nested: true } }, { ...order, id: 'x'.repeat(1001) }, { ...order, id: token }]) {
      fixture.query.mockReset().mockResolvedValueOnce([row]); await expect(fetchMappedEvidence(token, ref, mapping, 'pi_verified')).rejects.toBeDefined(); expect(fixture.query).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects unrelated child records instead of silently filtering them', async () => {
    fixture.query.mockReset().mockResolvedValueOnce([order]).mockResolvedValueOnce([order]).mockResolvedValueOnce([{ order_id: 'OTHER', status: 'delivered' }]);
    await expect(fetchMappedEvidence(token, ref, mapping, 'pi_verified')).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });
  it('labels truncated or empty related results and collapses identical records', async () => {
    fixture.query.mockReset().mockResolvedValueOnce([order]).mockResolvedValueOnce([order]).mockResolvedValueOnce(Array.from({ length: 6 }, (_, i) => ({ order_id: order.id, status: `status${i}` })));
    const truncated = await fetchMappedEvidence(token, ref, mapping, 'pi_verified'); expect(truncated.records).toHaveLength(6); expect(truncated.limitations.join(' ')).toContain('only five');
    fixture.query.mockReset().mockResolvedValueOnce([order]).mockResolvedValueOnce([order]).mockResolvedValueOnce([]);
    expect((await fetchMappedEvidence(token, ref, mapping, 'pi_verified')).limitations.join(' ')).toContain('does not establish');
    fixture.query.mockReset().mockResolvedValueOnce([order]).mockResolvedValueOnce([order]).mockResolvedValueOnce([{ order_id: order.id, status: 'same' }, { order_id: order.id, status: 'same' }]);
    expect((await fetchMappedEvidence(token, ref, mapping, 'pi_verified')).records).toHaveLength(2);
  });
});
