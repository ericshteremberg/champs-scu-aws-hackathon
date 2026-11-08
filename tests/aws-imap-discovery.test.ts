import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const dns = vi.hoisted(() => ({ mx: vi.fn(), srv: vi.fn(), cancel: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(), Resolver: class { resolveMx = dns.mx; resolveSrv = dns.srv; cancel = dns.cancel; } }));
import { discoverImap } from '../aws/imap-discovery.ts';
beforeEach(() => { vi.clearAllMocks(); dns.mx.mockResolvedValue([]); dns.srv.mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());
describe('password-free email provider discovery', () => {
  it('recognizes the documented Network Solutions MX set without sending a mailbox name', async () => {
    dns.mx.mockResolvedValue([1, 2, 3, 4].map(n => ({ exchange: `mx00${n}.netsol.xion.oxcs.net.`, priority: 10 })));
    expect(await discoverImap('private-name@broeseevents.com')).toEqual({ kind: 'imap', provider: 'Network Solutions', host: 'netsol-imap-oxcs.hostingplatform.com', source: 'provider_dns' });
    expect(dns.mx).toHaveBeenCalledWith('broeseevents.com'); expect(dns.srv).toHaveBeenCalledWith('_imaps._tcp.broeseevents.com'); expect(dns.cancel).toHaveBeenCalledOnce();
  });
  it.each(['mx001.netsol.xion.oxcs.net.attacker.com', 'mx1.netsolmail.net'])('does not guess settings for %s', async exchange => {
    dns.mx.mockResolvedValue([{ exchange }]); expect(await discoverImap('a@business.com')).toEqual({ kind: 'manual', reason: 'unknown' });
  });
  it('does not classify mixed MX providers', async () => {
    dns.mx.mockResolvedValue([{ exchange: 'mx001.netsol.xion.oxcs.net' }, { exchange: 'mail.other.com' }]);
    expect(await discoverImap('a@business.com')).toMatchObject({ kind: 'manual' });
  });
  it.each([['gmail.com', 'Google'], ['outlook.com', 'Microsoft']])('routes %s to OAuth without DNS', async (domain, provider) => {
    expect(await discoverImap(`a@${domain}`)).toEqual({ kind: 'oauth', provider }); expect(dns.mx).not.toHaveBeenCalled();
  });
  it.each([['aspmx.l.google.com', 'Google'], ['company-com.mail.protection.outlook.com', 'Microsoft']])('recognizes hosted mail via %s', async (exchange, provider) => {
    dns.mx.mockResolvedValue([{ exchange }]); expect(await discoverImap('a@business.com')).toEqual({ kind: 'oauth', provider });
  });
  it('selects a public TLS SRV target by priority and never uses MX as a login server', async () => {
    dns.mx.mockResolvedValue([{ exchange: 'smtp.business.com' }]);
    dns.srv.mockResolvedValue([{ name: 'plain.business.com', port: 143, priority: 0 }, { name: '127.0.0.1', port: 993, priority: 0 }, { name: 'later.business.com', port: 993, priority: 20 }, { name: 'imap.business.com.', port: 993, priority: 10 }]);
    expect(await discoverImap('a@business.com')).toEqual({ kind: 'imap', provider: 'business.com', host: 'imap.business.com', source: 'imaps_srv' });
  });
  it.each(['not-email', 'a@localhost', 'a@127.0.0.1', 'a@host.internal', 'a@business.com\npassword'])('rejects invalid domain input %s before DNS', async input => {
    await expect(discoverImap(input)).rejects.toMatchObject({ code: 'invalid_request' }); expect(dns.mx).not.toHaveBeenCalled();
  });
  it('offers manual fallback on DNS errors without exposing the resolver error', async () => {
    dns.mx.mockRejectedValue(new Error('internal diagnostic')); dns.srv.mockRejectedValue(new Error('internal diagnostic'));
    expect(await discoverImap('a@business.com')).toEqual({ kind: 'manual', reason: 'unavailable' });
  });
  it('bounds stalled discovery to five seconds and cancels DNS', async () => {
    vi.useFakeTimers(); dns.mx.mockImplementation(() => new Promise(() => {})); dns.srv.mockImplementation(() => new Promise(() => {}));
    const pending = discoverImap('a@business.com'); await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ kind: 'manual', reason: 'unavailable' }); expect(dns.cancel).toHaveBeenCalledOnce();
  });
});
