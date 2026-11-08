import { randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { normalizeMerchantSection, type MerchantSection } from '../lib/investigation/merchant.ts';
import { EVIDENCE_SECTIONS, InvestigationError, type EvidenceSection } from '../lib/investigation/types.ts';

const MAX_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 9000;
const deniedV4 = new BlockList();
const deniedV6 = new BlockList();
const globalV6 = new BlockList();

// Conservatively exclude IANA special-purpose space, including globally reachable
// special-purpose exceptions. User connectors must be ordinary public services.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) deniedV4.addSubnet(address, prefix, 'ipv4');
// Azure's platform virtual IP is public-looking but is not a merchant endpoint.
deniedV4.addAddress('168.63.129.16', 'ipv4');

// Allow only global unicast, then exclude special-purpose ranges within it.
// This also excludes mapped IPv4, NAT64, multicast, unique-local and link-local.
// https://www.iana.org/assignments/iana-ipv6-special-registry/
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['2620:4f:8000::', 48], ['3fff::', 20],
] as const) deniedV6.addSubnet(address, prefix, 'ipv6');

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !deniedV4.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
  return false;
}

const configurationError = () => new InvestigationError('merchant_configuration', 'Use a public HTTPS connector URL on port 443 without credentials, a query, or a fragment.');
const blockedHost = () => new InvestigationError('merchant_host_blocked', 'The connector must resolve only to public internet addresses.');
const unavailable = () => new InvestigationError('merchant_unavailable', 'The merchant evidence API could not be reached. Check its connection and case grant.');
const stopped = () => new InvestigationError('stopped', 'The investigation was stopped.');

/** Synchronous validation is followed by DNS validation on every actual read. */
export function validatePublicMerchantUrl(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\?#]/.test(raw) || !/^https:\/\//i.test(raw)) throw configurationError();
  let base: URL;
  try { base = new URL(raw); } catch { throw configurationError(); }
  if (base.protocol !== 'https:' || (base.port && base.port !== '443') || base.username || base.password || /^https:\/\/[^/]*@/i.test(raw)) throw configurationError();
  const hostname = base.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(hostname)) {
    if (!publicAddress(hostname)) throw blockedHost();
  } else {
    const labels = hostname.split('.');
    if (hostname.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw configurationError();
    if (/(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion|arpa)$/i.test(hostname)) throw blockedHost();
    base.hostname = hostname;
  }
  return base.toString().replace(/\/+$/, '');
}

interface PublicMerchantConfiguration { baseUrl: string; token: string }
interface RawResponse { status: number; body?: unknown }

/** Server-only dependency injection for deterministic transport tests. */
export interface MerchantNetworkDependencies {
  lookup: (hostname: string) => Promise<LookupAddress[]>;
  request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
}

export function createPublicMerchantTransport(overrides: Partial<MerchantNetworkDependencies> = {}) {
  const dependencies: MerchantNetworkDependencies = {
    lookup: hostname => dnsLookup(hostname, { all: true, order: 'verbatim' }),
    request: (options, callback) => httpsRequest(options, callback),
    ...overrides,
  };

  async function read(config: PublicMerchantConfiguration, caseId: string, section: EvidenceSection, signal: AbortSignal, statusOnly = false): Promise<RawResponse> {
    if (signal.aborted) throw stopped();
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(caseId)) throw new InvestigationError('invalid_case_id', 'The merchant case identifier is invalid.');
    if (!EVIDENCE_SECTIONS.includes(section)) throw new InvestigationError('invalid_evidence', 'The evidence section is invalid.');
    const base = validatePublicMerchantUrl(config.baseUrl);
    if (typeof config.token !== 'string' || config.token.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(config.token)) {
      throw new InvestigationError('merchant_configuration', 'The connector needs a valid server-side bearer credential.');
    }
    const target = new URL(`${base}/v1/cases/${encodeURIComponent(caseId)}/evidence?section=${section}`);
    const hostname = target.hostname.replace(/^\[|\]$/g, '');

    return new Promise<RawResponse>((resolve, reject) => {
      let settled = false;
      let request: ClientRequest | undefined;
      let response: IncomingMessage | undefined;
      const finish = (error?: InvestigationError, result?: RawResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        // Destroy sockets on every exit, including early status-only responses.
        // No agent pooling can bypass the next request's DNS validation.
        response?.destroy();
        request?.destroy();
        if (error) reject(error);
        else resolve(result!);
      };
      const abort = () => finish(stopped());
      // The deadline includes DNS, connection, TLS, headers and the complete body.
      // Two verification reads therefore fit inside the API's 20-second budget.
      const timeout = setTimeout(() => finish(new InvestigationError('merchant_timeout', 'The merchant evidence request timed out.')), REQUEST_TIMEOUT_MS);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }

      void (async () => {
        let addresses: LookupAddress[];
        try {
          addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await dependencies.lookup(hostname);
        } catch { finish(unavailable()); return; }
        if (settled) return;
        if (!addresses.length || addresses.some(answer => !publicAddress(answer.address) || answer.family !== isIP(answer.address))) {
          finish(blockedHost()); return;
        }
        // Capture immutable primitives. Do not look up the host a second time when
        // opening the socket, even if DNS now advertises an internal address.
        // Lambda environments commonly lack IPv6 egress. Prefer IPv4 when both
        // families are public, after validating every answer above.
        const selected = addresses.find(answer => answer.family === 4) ?? addresses[0];
        const address = selected.address;
        const family = selected.family;
        const lookup: NonNullable<RequestOptions['lookup']> = (name, options, callback) => {
          if (name !== hostname) { callback(new Error('Connector hostname mismatch.'), '', family); return; }
          if (options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        };
        try {
          const options: RequestOptions & { autoSelectFamily: false } = {
            protocol: 'https:', hostname, port: 443, method: 'GET',
            path: `${target.pathname}${target.search}`,
            headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json', 'Accept-Encoding': 'identity' },
            lookup, family, autoSelectFamily: false, agent: false,
            servername: isIP(hostname) ? undefined : hostname,
            rejectUnauthorized: true, maxHeaderSize: 16 * 1024,
          };
          request = dependencies.request(options, incoming => {
            response = incoming;
            // Ignore raw upstream errors: they can contain addresses or secrets.
            incoming.on('error', () => finish(unavailable()));
            incoming.on('aborted', () => finish(unavailable()));
            if (settled) { incoming.destroy(); return; }
            const status = incoming.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              finish(new InvestigationError('merchant_redirect', 'The connector must return evidence directly without redirects.')); return;
            }
            if (statusOnly || status < 200 || status >= 300) { finish(undefined, { status }); return; }
            const contentType = incoming.headers['content-type'];
            const encoding = incoming.headers['content-encoding'];
            if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType) || (encoding && encoding.toLowerCase() !== 'identity')) {
              finish(new InvestigationError('invalid_evidence', 'The merchant evidence API must return uncompressed JSON.')); return;
            }
            const length = incoming.headers['content-length'];
            if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
              finish(new InvestigationError('evidence_too_large', 'The merchant response exceeds the 1 MB limit.')); return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            incoming.on('data', (chunk: Buffer) => {
              if (settled) return;
              total += chunk.byteLength;
              if (total > MAX_BYTES) {
                finish(new InvestigationError('evidence_too_large', 'The merchant response exceeds the 1 MB limit.')); return;
              }
              chunks.push(chunk);
            });
            incoming.on('end', () => {
              if (settled) return;
              const text = Buffer.concat(chunks, total).toString('utf8');
              if (text.includes(config.token)) {
                finish(new InvestigationError('invalid_evidence', 'The merchant response included a connector credential and was rejected.')); return;
              }
              let body: unknown;
              // Check again after JSON escape decoding so an echoed credential
              // cannot enter records, model context or browser-facing evidence.
              try {
                body = JSON.parse(text);
                if (JSON.stringify(body).includes(config.token)) {
                  finish(new InvestigationError('invalid_evidence', 'The merchant response included a connector credential and was rejected.')); return;
                }
              } catch {
                finish(new InvestigationError('invalid_evidence', 'The merchant returned invalid or excessively nested JSON.')); return;
              }
              finish(undefined, { status, body });
            });
          });
          request.on('error', () => finish(unavailable()));
          request.end();
          // Also handles an injected synchronous response callback in tests.
          if (settled) request.destroy();
        } catch { finish(unavailable()); }
      })();
    });
  }

  async function fetchPublicMerchantSection(config: PublicMerchantConfiguration, caseId: string, section: EvidenceSection, signal: AbortSignal): Promise<MerchantSection> {
    const result = await read(config, caseId, section, signal);
    if (signal.aborted) throw stopped();
    if ([401, 403].includes(result.status)) throw new InvestigationError('merchant_access_denied', 'The merchant denied access to this approved case.');
    if (result.status === 404) throw new InvestigationError('merchant_not_found', 'The merchant case or evidence section was not found.');
    if (result.status < 200 || result.status >= 300) throw unavailable();
    return normalizeMerchantSection(result.body, caseId, section);
  }

  async function verifyPublicMerchantConnection(config: PublicMerchantConfiguration, caseId: string, signal: AbortSignal): Promise<MerchantSection> {
    const summary = await fetchPublicMerchantSection(config, caseId, 'summary', signal);
    let otherCase: string;
    do { otherCase = `probe_${randomUUID().replace(/-/g, '')}`; } while (otherCase === caseId);
    const probe = await read(config, otherCase, 'summary', signal, true);
    if (signal.aborted) throw stopped();
    if (![401, 403, 404].includes(probe.status)) {
      throw new InvestigationError('merchant_scope_unverified', 'The connector must deny access to an unapproved case with HTTP 401, 403, or 404.');
    }
    return summary;
  }

  return { fetchPublicMerchantSection, verifyPublicMerchantConnection };
}

const publicTransport = createPublicMerchantTransport();
export const fetchPublicMerchantSection = publicTransport.fetchPublicMerchantSection;
export const verifyPublicMerchantConnection = publicTransport.verifyPublicMerchantConnection;
