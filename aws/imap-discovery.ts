import { Resolver } from 'node:dns/promises';
import { z } from 'zod';
import { ApiError } from './types.ts';
import { imapHostname } from './imap-api.ts';
import type { ImapDiscovery } from '../lib/providers/types.ts';

export const discoveryEmail = z.string().trim().email().max(254).refine(value => imapHostname.safeParse(value.slice(value.lastIndexOf('@') + 1).toLowerCase()).success);
const normalize = (value: string) => value.toLowerCase().replace(/\.$/, '');
// Match only documented provider MX sets. MX is never used as an IMAP hostname.
// https://www.networksolutions.com/help/article/cloud-mail-dns-settings
const networkSolutions = /^mx00[1-4]\.netsol\.xion\.oxcs\.net$/;
const google = /^(?:(?:alt[1-4]\.)?aspmx\.l\.google\.com|smtp\.google\.com)$/;
const microsoft = /^(?:[a-z0-9-]+\.)+mail\.protection\.outlook\.com$/;
export async function discoverImap(input: string): Promise<ImapDiscovery> {
  const parsed = discoveryEmail.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Enter a valid email address with a public domain.', 'invalid_request');
  const domain = parsed.data.slice(parsed.data.lastIndexOf('@') + 1).toLowerCase();
  if (['gmail.com', 'googlemail.com'].includes(domain)) return { kind: 'oauth', provider: 'Google' };
  if (['outlook.com', 'hotmail.com', 'live.com'].includes(domain)) return { kind: 'oauth', provider: 'Microsoft' };
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<ImapDiscovery> => {
        // Only the domain goes into DNS. No mailbox name, password or HTTP request.
        const [mxResult, srvResult] = await Promise.allSettled([resolver.resolveMx(domain), resolver.resolveSrv(`_imaps._tcp.${domain}`)]);
        const mx = mxResult.status === 'fulfilled' && mxResult.value.length <= 50 ? mxResult.value.map(r => normalize(r.exchange)) : [];
        if (mx.length && mx.every(host => google.test(host))) return { kind: 'oauth', provider: 'Google' };
        if (mx.length && mx.every(host => microsoft.test(host))) return { kind: 'oauth', provider: 'Microsoft' };
        if (mx.length && mx.every(host => networkSolutions.test(host))) return { kind: 'imap', provider: 'Network Solutions', host: 'netsol-imap-oxcs.hostingplatform.com', source: 'provider_dns' };
        if (srvResult.status === 'fulfilled' && srvResult.value.length <= 50) {
          const choices = srvResult.value.filter(r => r.port === 993 && imapHostname.safeParse(normalize(r.name)).success).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
          if (choices.length) return { kind: 'imap', provider: domain, host: normalize(choices[0].name), source: 'imaps_srv' };
        }
        return { kind: 'manual', reason: mxResult.status === 'rejected' && srvResult.status === 'rejected' && ![mxResult.reason?.code, srvResult.reason?.code].every(code => ['ENOTFOUND', 'ENODATA'].includes(code)) ? 'unavailable' : 'unknown' };
      })(),
      new Promise<ImapDiscovery>(resolve => { timer = setTimeout(() => resolve({ kind: 'manual', reason: 'unavailable' }), 5000); }),
    ]);
  } finally { clearTimeout(timer); resolver.cancel(); }
}
