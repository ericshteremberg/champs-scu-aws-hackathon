import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { LookupAddress } from 'node:dns';
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicMerchantTransport, validatePublicMerchantUrl, type MerchantNetworkDependencies } from '../aws/merchant-network.ts';

const config = { baseUrl: 'https://merchant.example.com/connector', token: 'synthetic_private_connector_token' };
const caseId = 'case_approved';
const stamp = '2026-11-07T18:00:00Z';
const signal = () => new AbortController().signal;

function evidence(section = 'summary', id = caseId) {
  return {
    case_id: id, section, source_mode: 'live', fetched_at: stamp, status: 'available', limitations: [],
    records: [{ evidence_id: 'source_1', source: 'merchant', source_id: 'order_1', occurred_at: stamp,
      data: { title: 'Verified payment and order', detail: 'Approved evidence', fields: { orderRef: 'order_1', paymentRef: 'payment_1' } } }],
    mapping_verified: true,
    case: { id, merchantId: 'merchant_1', merchantName: 'Merchant', customerLabel: 'Customer', claim: 'Ticket not received',
      reason: 'product_not_received', amount: 5000, currency: 'USD', eventName: 'Event', purchasedAt: stamp, openedAt: stamp,
      dueAt: stamp, sourceMode: 'live', summary: 'Verified case', orderRef: 'order_1', paymentRef: 'payment_1', tags: [] },
  };
}

interface ResponsePlan {
  status?: number;
  headers?: IncomingHttpHeaders;
  body?: unknown;
  chunks?: Buffer[];
  error?: Error;
  stall?: boolean;
  delayMs?: number;
}

function harness(plans: ResponsePlan[] = [{ body: evidence() }], addresses: LookupAddress[] = [{ address: '93.184.215.14', family: 4 }]) {
  const options: RequestOptions[] = [];
  const requests: ClientRequest[] = [];
  const responses: IncomingMessage[] = [];
  const lookup = vi.fn(async () => addresses);
  const request = vi.fn<MerchantNetworkDependencies['request']>((settings, callback) => {
    options.push(settings);
    const plan = plans[requests.length] ?? {};
    const outgoing = new EventEmitter() as ClientRequest;
    outgoing.destroy = vi.fn(() => outgoing);
    outgoing.end = vi.fn(() => {
      const respond = () => {
        if (plan.error) { outgoing.emit('error', plan.error); return; }
        if (plan.stall) return;
        const incoming = new PassThrough() as PassThrough & IncomingMessage;
        incoming.statusCode = plan.status ?? 200;
        incoming.headers = { 'content-type': 'application/json', ...plan.headers };
        responses.push(incoming);
        callback(incoming);
        for (const chunk of plan.chunks ?? [Buffer.from(JSON.stringify(plan.body ?? evidence()))]) {
          if (!incoming.destroyed) incoming.write(chunk);
        }
        incoming.end();
      };
      if (plan.delayMs) setTimeout(respond, plan.delayMs);
      else void Promise.resolve().then(respond);
      return outgoing;
    }) as ClientRequest['end'];
    requests.push(outgoing);
    return outgoing;
  });
  return { ...createPublicMerchantTransport({ lookup, request }), lookup, request, options, requests, responses };
}

afterEach(() => vi.useRealTimers());

describe('public merchant URL validation', () => {
  it('canonicalizes HTTPS base paths and the default port', () => {
    expect(validatePublicMerchantUrl('https://MERCHANT.example.com.:443/connector///')).toBe(config.baseUrl);
    expect(validatePublicMerchantUrl('https://93.184.215.14/')).toBe('https://93.184.215.14');
    expect(validatePublicMerchantUrl('https://[2606:4700:4700::1111]/')).toBe('https://[2606:4700:4700::1111]');
  });

  it.each([
    'http://merchant.example.com', 'https://merchant.example.com:8443', 'https://user:password@merchant.example.com',
    'https://@merchant.example.com', 'https://merchant.example.com?token=secret', 'https://merchant.example.com?',
    'https://merchant.example.com#secret', 'https://merchant.example.com#', 'https://merchant.example.com\n',
    'https://merchant.example.com\\@127.0.0.1', 'https://singlehost', 'https://-bad.example.com',
  ])('rejects invalid authority or URL state: %s', raw => {
    expect(() => validatePublicMerchantUrl(raw)).toThrow();
  });

  it.each([
    'localhost', 'test.localhost', 'host.local', 'metadata.google.internal', 'service.test',
    '127.0.0.1', '127.1', '2130706433', '0x7f000001', '0177.0.0.1', '0.0.0.0',
    '10.1.1.1', '100.100.100.200', '169.254.169.254', '168.63.129.16', '172.31.255.255',
    '192.168.1.1', '192.0.0.9', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '255.255.255.255', '[::]', '[::1]', '[fc00::1]', '[fd00:ec2::254]', '[fe80::1]',
    '[ff02::1]', '[::ffff:127.0.0.1]', '[::ffff:169.254.169.254]', '[::ffff:93.184.215.14]',
    '[64:ff9b::a9fe:a9fe]', '[2001::1]', '[2001:db8::1]', '[2002:7f00:1::1]', '[3fff::1]',
  ])('blocks private, local and reserved hosts: %s', host => {
    expect(() => validatePublicMerchantUrl(`https://${host}`)).toThrow();
  });
});

describe('DNS pinning and authenticated HTTPS', () => {
  it('pins the validated IP while retaining the original hostname for TLS and the Host header', async () => {
    const addresses = [{ address: '93.184.215.14', family: 4 }];
    const transport = harness([{ body: evidence() }], addresses);
    const result = await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal());
    expect(result).toMatchObject({ mappingVerified: true, case: { id: caseId }, evidence: { sourceMode: 'live' } });
    expect(transport.lookup).toHaveBeenCalledExactlyOnceWith('merchant.example.com');
    const options = transport.options[0];
    expect(options).toMatchObject({ hostname: 'merchant.example.com', servername: 'merchant.example.com', port: 443,
      method: 'GET', rejectUnauthorized: true, agent: false, autoSelectFamily: false, family: 4,
      path: `/connector/v1/cases/${caseId}/evidence?section=summary`,
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json', 'Accept-Encoding': 'identity' } });
    // The DNS source changes after validation. Socket lookup must still return the
    // captured public address, including when Node requests an all-address answer.
    addresses[0].address = '169.254.169.254';
    const single = vi.fn(); const all = vi.fn(); const wrongHost = vi.fn();
    options.lookup!('merchant.example.com', {}, single);
    options.lookup!('merchant.example.com', { all: true }, all);
    options.lookup!('other.example.com', {}, wrongHost);
    expect(single).toHaveBeenCalledWith(null, '93.184.215.14', 4);
    expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.215.14', family: 4 }]);
    expect(wrongHost.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(transport.lookup).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ address: '10.0.0.1', family: 4 }],
    [{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }],
    [{ address: '2606:4700:4700::1111', family: 6 }, { address: 'fd00:ec2::254', family: 6 }],
    [{ address: '::ffff:169.254.169.254', family: 6 }],
    [{ address: '93.184.215.14', family: 6 }], [],
  ])('rejects every nonpublic or mixed DNS answer before sending credentials: %j', async (...answers) => {
    const transport = harness([], answers as LookupAddress[]);
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'summary', signal())).rejects.toMatchObject({ code: 'merchant_host_blocked' });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('supports global IPv6 and validates DNS anew for subsequent requests', async () => {
    const transport = harness([{ body: evidence() }], [{ address: '2606:4700:4700::1111', family: 6 }]);
    await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal());
    expect(transport.options[0].family).toBe(6);
    transport.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'summary', signal())).rejects.toMatchObject({ code: 'merchant_host_blocked' });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('prefers validated IPv4 when DNS returns IPv6 first for a dual-stack endpoint', async () => {
    const transport = harness([{ body: evidence() }], [{ address: '2606:4700:4700::1111', family: 6 }, { address: '93.184.215.14', family: 4 }]);
    await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal());
    expect(transport.options[0].family).toBe(4);
    const callback = vi.fn();
    transport.options[0].lookup!('merchant.example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.215.14', 4);
  });

  it('rejects header injection, invalid case identifiers and sections before DNS', async () => {
    const transport = harness();
    await expect(transport.fetchPublicMerchantSection({ ...config, token: 'token\r\nHeader: injected' }, caseId, 'summary', signal())).rejects.toMatchObject({ code: 'merchant_configuration' });
    await expect(transport.fetchPublicMerchantSection(config, '../other_case', 'summary', signal())).rejects.toMatchObject({ code: 'invalid_case_id' });
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'summary&other=1' as 'summary', signal())).rejects.toMatchObject({ code: 'invalid_evidence' });
    expect(transport.lookup).not.toHaveBeenCalled();
  });
});

describe('bounded, sanitized connector responses', () => {
  it('rejects redirects without following the destination or exposing headers', async () => {
    const transport = harness([{ status: 302, headers: { location: `https://127.0.0.1/${config.token}` } }]);
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'summary', signal())).rejects.toMatchObject({ code: 'merchant_redirect' });
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(transport.responses[0].destroyed).toBe(true);
  });

  it.each([
    { headers: { 'content-length': String(1024 * 1024 + 1) } },
    { chunks: [Buffer.alloc(700000), Buffer.alloc(400000)] },
  ])('enforces the 1 MB cap on declared and streamed bytes', async plan => {
    const transport = harness([plan]);
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'summary', signal())).rejects.toMatchObject({ code: 'evidence_too_large' });
    expect(transport.responses[0].destroyed).toBe(true);
    expect(transport.requests[0].destroy).toHaveBeenCalled();
  });

  it.each([
    { headers: { 'content-type': 'text/html' } },
    { headers: { 'content-type': 'application/jsonp' } },
    { headers: { 'content-encoding': 'gzip' } },
    { chunks: [Buffer.from(`invalid JSON ${config.token}`)] },
    { chunks: [Buffer.from('['.repeat(15000) + '0' + ']'.repeat(15000))] },
  ])('rejects non-JSON, compressed and malformed responses without echoing content', async plan => {
    const transport = harness([plan]);
    const error = await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal()).catch(error => error);
    expect(error).toMatchObject({ code: 'invalid_evidence' });
    expect(error.message).not.toContain(config.token);
  });

  it.each([[401, 'merchant_access_denied'], [403, 'merchant_access_denied'], [404, 'merchant_not_found'], [500, 'merchant_unavailable']] as const)('sanitizes HTTP %i', async (status, code) => {
    const transport = harness([{ status, body: config.token }]);
    const error = await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal()).catch(error => error);
    expect(error).toMatchObject({ code });
    expect(error.message).not.toContain(config.token);
  });

  it('sanitizes network and DNS errors', async () => {
    const transport = harness([{ error: new Error(`TLS failure: ${config.token}`) }]);
    let error = await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal()).catch(error => error);
    expect(error).toMatchObject({ code: 'merchant_unavailable' });
    expect(error.message).not.toContain(config.token);
    transport.lookup.mockRejectedValueOnce(new Error(`DNS failure: ${config.token}`));
    error = await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal()).catch(error => error);
    expect(error).toMatchObject({ code: 'merchant_unavailable' });
    expect(error.message).not.toContain(config.token);
  });

  it('preserves evidence scope and verified payment/order requirements', async () => {
    const wrongCase = harness([{ body: evidence('summary', 'other_case') }]);
    await expect(wrongCase.fetchPublicMerchantSection(config, caseId, 'summary', signal())).rejects.toMatchObject({ code: 'evidence_scope_mismatch' });
    const wrongMapping = evidence(); wrongMapping.case.paymentRef = 'unrelated_payment';
    const transport = harness([{ body: wrongMapping }]);
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'summary', signal())).rejects.toMatchObject({ code: 'mapping_mismatch' });
  });

  it.each([false, true])('rejects echoed credentials before they become evidence, including escaped JSON: %s', async escaped => {
    const body = evidence(); body.records[0].data.detail = config.token;
    let json = JSON.stringify(body);
    if (escaped) json = json.replace(config.token, '\\u0073' + config.token.slice(1));
    const transport = harness([{ chunks: [Buffer.from(json)] }]);
    const error = await transport.fetchPublicMerchantSection(config, caseId, 'summary', signal()).catch(error => error);
    expect(error).toMatchObject({ code: 'invalid_evidence' });
    expect(error.message).not.toContain(config.token);
  });

  it('normalizes non-summary sections without requiring case metadata', async () => {
    const transport = harness([{ body: { ...evidence('tickets'), case: undefined, mapping_verified: undefined } }]);
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'tickets', signal())).resolves.toMatchObject({ mappingVerified: false, evidence: { section: 'tickets' } });
  });

  it('times out a stalled socket and destroys it', async () => {
    vi.useFakeTimers();
    const transport = harness([{ stall: true }]);
    const result = transport.fetchPublicMerchantSection(config, caseId, 'summary', signal());
    const check = expect(result).rejects.toMatchObject({ code: 'merchant_timeout' });
    await vi.advanceTimersByTimeAsync(9000);
    await check;
    expect(transport.requests[0].destroy).toHaveBeenCalled();
  });

  it('includes DNS in the deadline and never sends a late request', async () => {
    vi.useFakeTimers();
    const transport = harness();
    let resolveLookup!: (addresses: LookupAddress[]) => void;
    transport.lookup.mockImplementationOnce(() => new Promise(resolve => { resolveLookup = resolve; }));
    const result = transport.fetchPublicMerchantSection(config, caseId, 'summary', signal());
    const check = expect(result).rejects.toMatchObject({ code: 'merchant_timeout' });
    await vi.advanceTimersByTimeAsync(9000);
    await check;
    resolveLookup([{ address: '93.184.215.14', family: 4 }]);
    await Promise.resolve();
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('honors caller cancellation before DNS and during a pending request', async () => {
    const transport = harness([{ stall: true }]);
    const controller = new AbortController();
    const result = transport.fetchPublicMerchantSection(config, caseId, 'summary', controller.signal);
    const check = expect(result).rejects.toMatchObject({ code: 'stopped' });
    await Promise.resolve();
    controller.abort();
    await check;
    expect(transport.requests[0].destroy).toHaveBeenCalled();
    transport.lookup.mockClear();
    await expect(transport.fetchPublicMerchantSection(config, caseId, 'summary', controller.signal)).rejects.toMatchObject({ code: 'stopped' });
    expect(transport.lookup).not.toHaveBeenCalled();
  });
});

describe('live connector verification', () => {
  it.each([401, 403, 404])('requires real summary evidence and HTTP %i for a random unapproved case', async status => {
    const transport = harness([{ body: evidence() }, { status, headers: { 'content-type': 'text/plain' }, body: config.token }]);
    await expect(transport.verifyPublicMerchantConnection(config, caseId, signal())).resolves.toMatchObject({ mappingVerified: true, case: { id: caseId } });
    expect(transport.options).toHaveLength(2);
    expect(transport.options[1].path).toMatch(/^\/connector\/v1\/cases\/probe_[a-f0-9]{32}\/evidence\?section=summary$/);
    expect(transport.options[1].path).not.toContain(caseId);
    expect(transport.options[1].headers).toEqual(transport.options[0].headers);
    expect(transport.lookup).toHaveBeenCalledTimes(2);
  });

  it.each([200, 204, 400, 429, 500])('fails closed when the unapproved case returns HTTP %i', async status => {
    const transport = harness([{ body: evidence() }, { status, body: evidence('summary', 'other_case') }]);
    await expect(transport.verifyPublicMerchantConnection(config, caseId, signal())).rejects.toMatchObject({ code: 'merchant_scope_unverified' });
  });

  it('does not probe if the approved case has not passed normal evidence validation', async () => {
    const transport = harness([{ body: { ...evidence(), mapping_verified: false } }]);
    await expect(transport.verifyPublicMerchantConnection(config, caseId, signal())).rejects.toMatchObject({ code: 'unverified_case' });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('bounds both verification reads to less than 20 seconds combined', async () => {
    vi.useFakeTimers();
    const transport = harness([{ body: evidence(), delayMs: 8900 }, { stall: true }]);
    const start = Date.now();
    const result = transport.verifyPublicMerchantConnection(config, caseId, signal());
    const check = expect(result).rejects.toMatchObject({ code: 'merchant_timeout' });
    await vi.advanceTimersByTimeAsync(17900);
    await check;
    expect(Date.now() - start).toBeLessThan(20000);
    expect(transport.request).toHaveBeenCalledTimes(2);
  });
});
