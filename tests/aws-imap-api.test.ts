import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ list: vi.fn(), lookup: vi.fn(), options: [] as Record<string, unknown>[], connect: vi.fn(), close: vi.fn(), open: vi.fn(), search: vi.fn(), fetch: vi.fn(), fetchOne: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: fixture.lookup }));
vi.mock('imapflow', () => ({ ImapFlow: class {
  constructor(options: Record<string, unknown>) { fixture.options.push(options); }
  on() { return this; }
  list = fixture.list; connect = fixture.connect; close = fixture.close; mailboxOpen = fixture.open; search = fixture.search; fetch = fixture.fetch; fetchOne = fixture.fetchOne;
} }));
import { imapSettingsSchema, publicImapAddress, verifyImap, searchImap, previewImap, parseImapText } from '../aws/imap-api.ts';
const settings = { host: 'imap.provider.com', email: 'merchant@example.test', password: 'synthetic_secret', folders: ['INBOX'] };
const box = { path: 'INBOX', uidValidity: BigInt(7), exists: 700, readOnly: true };
const row = { uid: 123, internalDate: new Date('2026-11-01'), envelope: { subject: 'Customer request', from: [{ address: 'customer@example.test' }], to: [{ address: 'merchant@example.test' }] } };
beforeEach(() => {
  vi.clearAllMocks(); fixture.list.mockResolvedValue([]); fixture.options.length = 0; fixture.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]); fixture.connect.mockResolvedValue(undefined); fixture.open.mockResolvedValue(box); fixture.search.mockResolvedValue([123]); fixture.fetch.mockImplementation(async function* () { yield row; });
});
afterEach(() => vi.useRealTimers());
describe('IMAP public TLS transport and bounded reads', () => {
  it.each(['localhost', '127.0.0.1', '169.254.169.254', '[::1]', 'https://imap.example.com', 'mail.example.com:143', 'mail.internal', 'mail.test', 'a..com'])('rejects invalid endpoint %s before network access', async host => {
    expect(imapSettingsSchema.safeParse({ ...settings, host }).success).toBe(false);
    await expect(publicImapAddress(host)).rejects.toMatchObject({ code: 'imap_host_invalid' }); expect(fixture.lookup).not.toHaveBeenCalled();
  });
  it.each(['10.0.0.1', '169.254.169.254', '127.0.0.1', '100.64.0.1', '168.63.129.16', '::1', '::ffff:127.0.0.1'])('rejects public names resolving to %s', async address => {
    fixture.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(verifyImap(settings)).rejects.toMatchObject({ code: 'imap_host_blocked' }); expect(fixture.connect).not.toHaveBeenCalled();
  });
  it('rejects mixed public/private answers and validates DNS again on each request', async () => {
    await verifyImap(settings);
    fixture.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.1', family: 4 }]);
    await expect(verifyImap(settings)).rejects.toMatchObject({ code: 'imap_host_blocked' }); expect(fixture.connect).toHaveBeenCalledTimes(1);
  });
  it('pins the validated IP while preserving TLS hostname verification and read-only folder opens', async () => {
    await verifyImap(settings);
    expect(fixture.options[0]).toMatchObject({ host: '93.184.216.34', servername: settings.host, port: 993, secure: true, logger: false, disableAutoIdle: true, disableCompression: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } });
    expect(fixture.open).toHaveBeenCalledWith('INBOX', { readOnly: true }); expect(fixture.close).toHaveBeenCalled();
    const tls = fixture.options[0].tls as { checkServerIdentity: (host: string, cert: unknown) => Error | undefined };
    expect(tls.checkServerIdentity('93.184.216.34', { subjectaltname: 'DNS:attacker.example.com', subject: {} })).toBeInstanceOf(Error);
    fixture.open.mockResolvedValueOnce({ ...box, readOnly: false }); await expect(verifyImap(settings)).rejects.toMatchObject({ code: 'imap_unavailable' });
  });
  it('uses only server-advertised Sent metadata and verifies both folders read-only', async () => {
    fixture.list.mockResolvedValue([{ path: 'Sent Items', flags: new Set(), specialUse: '\\Sent', specialUseSource: 'extension' }]);
    expect(await verifyImap(settings, true)).toEqual(['INBOX', 'Sent Items']);
    expect(fixture.open).toHaveBeenCalledWith('Sent Items', { readOnly: true });
    expect(fixture.search).not.toHaveBeenCalled(); expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it('does not guess Sent from names, ambiguous metadata or unselectable folders', async () => {
    const sent = { path: 'Sent', flags: new Set(), specialUse: '\\Sent', specialUseSource: 'extension' };
    for (const listing of [[{ ...sent, specialUseSource: 'name' }], [sent, { ...sent, path: 'Other Sent' }], [{ ...sent, flags: new Set(['\\Noselect']) }]]) {
      fixture.list.mockResolvedValue(listing); expect(await verifyImap(settings, true)).toEqual(['INBOX']);
    }
  });
  it('respects manual folders and bounds folder discovery', async () => {
    expect(await verifyImap({ ...settings, folders: ['INBOX', 'Replies'] }, true)).toEqual(['INBOX', 'Replies']);
    expect(fixture.list).not.toHaveBeenCalled();
    fixture.list.mockResolvedValue(Array(201).fill({ path: 'Folder' }));
    await expect(verifyImap(settings, true)).rejects.toMatchObject({ code: 'imap_folder_limit' });
  });
  it('bounds searches and confirms exact customer addresses after IMAP substring matching', async () => {
    fixture.search.mockResolvedValue([123, 124]);
    fixture.fetch.mockImplementation(async function* () { yield row; yield { ...row, uid: 124, envelope: { from: [{ address: 'othercustomer@example.test' }] } }; });
    const result = await searchImap(settings, 'customer@example.test');
    expect(fixture.search).toHaveBeenCalledWith({ seq: '201:700', deleted: false, or: [{ from: 'customer@example.test' }, { to: 'customer@example.test' }] }, { uid: true });
    expect(result).toMatchObject({ scanLimited: true, messages: [{ id: 'SU5CT1g.7.123' }] });
    expect(fixture.fetch.mock.calls[0][1]).not.toHaveProperty('source');
  });
  it('validates case email and rejects stale UIDVALIDITY or an unselected folder', async () => {
    await expect(searchImap(settings, 'customer@example.test\r\nALL')).rejects.toMatchObject({ code: 'imap_email_required' });
    await expect(previewImap(settings, 'U2VudA.7.123')).rejects.toMatchObject({ code: 'imap_selection_expired' });
    await expect(previewImap(settings, 'SU5CT1g.8.123')).rejects.toMatchObject({ code: 'imap_selection_expired' }); expect(fixture.fetchOne).not.toHaveBeenCalled();
  });
  it('fetches only the selected UID and limits the raw source before parsing', async () => {
    const source = Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\nI received my ticket.');
    fixture.fetchOne.mockResolvedValueOnce({ ...row, size: source.length }).mockResolvedValueOnce({ ...row, source });
    expect(await previewImap(settings, 'SU5CT1g.7.123')).toMatchObject({ text: 'I received my ticket.', truncated: false });
    expect(fixture.fetchOne).toHaveBeenLastCalledWith(123, { uid: true, source: { start: 0, maxLength: 262145 } }, { uid: true });
    fixture.fetchOne.mockResolvedValueOnce({ ...row, size: 262145 }); await expect(previewImap(settings, 'SU5CT1g.7.123')).rejects.toMatchObject({ code: 'imap_response_limit' });
  });
  it('ignores HTML and attached forwarded emails, decodes plain text and marks truncation', async () => {
    await expect(parseImapText(Buffer.from('Content-Type: text/html\r\n\r\n<p>Not plain text</p>'))).rejects.toMatchObject({ code: 'imap_plain_text_required' });
    const source = 'Content-Type: multipart/mixed; boundary=X\r\n\r\n--X\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=\r\n--X\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment\r\n\r\nContent-Type: text/plain\r\n\r\nATTACHED PRIVATE TEXT\r\n--X--';
    expect(await parseImapText(Buffer.from(source))).toEqual({ text: 'Hello', truncated: false });
    expect(await parseImapText(Buffer.from('Content-Type: text/plain\r\n\r\n' + 'x'.repeat(21000)))).toEqual({ text: 'x'.repeat(20000), truncated: true });
    await expect(parseImapText(Buffer.alloc(262145))).rejects.toMatchObject({ code: 'imap_response_limit' });
  });
  it.each(['synthetic_secret', 'quoted"secret\\text'])('rejects credential echoes including escaped values: %s', async password => {
    fixture.fetch.mockImplementation(async function* () { yield { ...row, envelope: { ...row.envelope, subject: password } }; });
    await expect(searchImap({ ...settings, password }, 'customer@example.test')).rejects.toMatchObject({ code: 'imap_unsafe_response' });
  });
  it('sanitizes authentication/transport errors and closes failed connections', async () => {
    fixture.connect.mockRejectedValueOnce(Object.assign(new Error('synthetic_secret on server'), { authenticationFailed: true }));
    await expect(verifyImap(settings)).rejects.toMatchObject({ code: 'imap_auth_failed', message: expect.not.stringContaining('synthetic_secret') }); expect(fixture.close).toHaveBeenCalled();
    fixture.connect.mockRejectedValueOnce(new Error('synthetic_secret')); await expect(verifyImap(settings)).rejects.toMatchObject({ code: 'imap_unavailable', message: expect.not.stringContaining('synthetic_secret') });
  });
  it('enforces a deadline even for stalled DNS and never connects after timeout', async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    fixture.lookup.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = expect(verifyImap(settings)).rejects.toMatchObject({ code: 'imap_unavailable' });
    await vi.advanceTimersByTimeAsync(16000); await pending;
    resolve([{ address: '93.184.216.34', family: 4 }]); await Promise.resolve(); await Promise.resolve(); expect(fixture.connect).not.toHaveBeenCalled();
  });
});
