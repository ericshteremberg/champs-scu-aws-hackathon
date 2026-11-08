import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const net = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: net.lookup }));
vi.mock('node:https', () => ({ request: net.request }));
import { fetchPolicyUrl } from '../aws/policy-source.ts';
beforeEach(() => {
  net.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  net.request.mockImplementation((_options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void }; req.end = () => { const res = Readable.from([Buffer.from('<p>Refund terms</p>')]) as Readable & { statusCode: number; headers: object }; res.statusCode = 200; res.headers = { 'content-type': 'text/html' }; callback(res); }; return req;
  });
});
afterEach(() => vi.clearAllMocks());
it('pins public DNS and never forwards authorization or cookies', async () => {
  expect(await fetchPolicyUrl('https://merchant.com/policy')).toMatchObject({ url: 'https://merchant.com/policy', mimeType: 'text/html' });
  const options = net.request.mock.calls[0][0]; expect(options.agent).toBe(false); expect(options.headers.Authorization).toBeUndefined(); expect(options.headers.Cookie).toBeUndefined();
  const cb = vi.fn(); options.lookup('merchant.com', { all: false }, cb); expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
});
it('blocks private IPs, credential-bearing URLs and mixed DNS responses', async () => {
  for (const url of ['http://merchant.com/policy', 'https://127.0.0.1/policy', 'https://user:secret@merchant.com/policy', 'https://merchant.com:8443/policy']) await expect(fetchPolicyUrl(url)).rejects.toMatchObject({ code: 'policy_url_blocked' });
  expect(net.request).not.toHaveBeenCalled();
  net.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
  await expect(fetchPolicyUrl('https://merchant.com/policy')).rejects.toMatchObject({ code: 'policy_url_blocked' }); expect(net.request).not.toHaveBeenCalled();
});
it('validates redirects before following them', async () => {
  net.request.mockImplementationOnce((_options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void }; req.end = () => { const res = Readable.from([]) as Readable & { statusCode: number; headers: object }; res.statusCode = 302; res.headers = { location: 'https://169.254.169.254/latest/meta-data' }; callback(res); }; return req;
  });
  await expect(fetchPolicyUrl('https://merchant.com/policy')).rejects.toMatchObject({ code: 'policy_url_blocked' }); expect(net.request).toHaveBeenCalledOnce();
});
