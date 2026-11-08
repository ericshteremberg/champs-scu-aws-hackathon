import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createHttpServer } from './server.ts';
import { createEvidenceHandler } from './adapter.ts';
import { fictionalCase, fictionalGrant, fixtureNow } from './fixtures.ts';
import { fetchMerchantSection } from '../../lib/investigation/merchant.ts';
describe('HTTP evidence service', () => {
  it('supports an actual HTTP consumer request and rejects duplicate authorization and writes', async () => {
    const handler = createEvidenceHandler({ findGrant: async () => fictionalGrant(), readCase: async () => fictionalCase() }, () => new Date(fixtureNow));
    const server = createHttpServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as AddressInfo).port; const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const result = await fetchMerchantSection({ baseUrl, token: 'fictional_token_at_least_32_characters', allowLocalHttp: true }, 'fictional_case_123', 'summary', new AbortController().signal);
      expect(result.mappingVerified).toBe(true);
      expect((await fetch(`${baseUrl}/v1/cases/fictional_case_123/evidence?section=summary`, { method: 'POST' })).status).toBe(405);
      const duplicate = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(`${baseUrl}/v1/cases/fictional_case_123/evidence?section=summary`, { headers: ['Host', `127.0.0.1:${port}`, 'Authorization', 'Bearer fictional_one', 'Authorization', 'Bearer fictional_two'] }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end();
      });
      expect(duplicate).toBe(401);
    } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
  });
});
