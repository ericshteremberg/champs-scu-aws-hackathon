import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { ImapFlow, type FetchMessageObject, type MailboxObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { publicAddress } from './merchant-network.ts';
import { ApiError } from './types.ts';
import type { ImapMessage, ImapPreview } from '../lib/providers/types.ts';

const MAX_BYTES = 256 * 1024;
const MAX_SCAN = 500;
export const imapHostname = z.string().trim().toLowerCase().max(253).refine(value => !isIP(value) && value.split('.').length >= 2 && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && !/(?:^|\.)(localhost|local|internal|home|lan|test|invalid|example|onion|arpa)$/.test(value));
const folder = z.string().min(1).max(150).refine(value => !/[\x00-\x1f\x7f]/.test(value) && Buffer.byteLength(value) <= 150).transform(value => value.toLowerCase() === 'inbox' ? 'INBOX' : value);
export const imapSettingsSchema = z.object({
  host: imapHostname,
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024).refine(value => !/[\r\n\x00]/.test(value)),
  folders: z.array(folder).min(1).max(2).refine(values => new Set(values).size === values.length),
}).strict();
export type ImapSettings = z.infer<typeof imapSettingsSchema>;
export const imapMessageId = z.string().regex(/^[a-zA-Z0-9_-]{1,220}\.[1-9][0-9]{0,19}\.[1-9][0-9]{0,9}$/);
const unavailable = () => new ApiError(502, 'Could not read this mailbox. Check the server, password, folder names and whether IMAP access is enabled.', 'imap_unavailable');
const limited = () => new ApiError(413, 'This email exceeds the preview limit. Import a reviewed excerpt manually.', 'imap_response_limit');
function containsCredential(value: unknown, credential: string): boolean {
  if (typeof value === 'string') return value.includes(credential);
  return value !== null && typeof value === 'object' && Object.values(value).some(part => containsCredential(part, credential));
}
const clean = (value: string | undefined, max = 1000) => (value || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max);
const idFor = (box: MailboxObject, uid: number) => `${Buffer.from(box.path).toString('base64url')}.${box.uidValidity}.${uid}`;
const envelopeMessage = (box: MailboxObject, message: FetchMessageObject): ImapMessage => ({
  id: idFor(box, message.uid), folder: box.path,
  subject: clean(message.envelope?.subject),
  from: clean(message.envelope?.from?.map(a => a.address || '').join(', ')),
  to: clean(message.envelope?.to?.map(a => a.address || '').join(', ')),
  occurredAt: new Date(message.internalDate || message.envelope?.date || 0).toISOString(),
});

// All endpoints are public DNS names on implicit TLS/993. Pin a validated address
// for the socket and check the certificate against the original hostname.
export async function publicImapAddress(host: string): Promise<string> {
  if (!imapHostname.safeParse(host).success) throw new ApiError(400, 'Enter a public IMAP hostname without a URL or port.', 'imap_host_invalid');
  const answers = await lookup(host, { all: true, order: 'ipv4first' });
  if (!answers.length || answers.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw new ApiError(400, 'The mail server must resolve only to public internet addresses.', 'imap_host_blocked');
  // Lambda deployment uses IPv4 egress. Do not silently fall back to another host.
  const address = answers.find(a => a.family === 4)?.address;
  if (!address) throw unavailable();
  return address;
}
async function withMailbox<T>(settings: ImapSettings, work: (client: ImapFlow) => Promise<T>): Promise<T> {
  let client: ImapFlow | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const address = await publicImapAddress(settings.host);
        if (stopped) throw unavailable();
        client = new ImapFlow({ host: address, servername: settings.host, port: 993, secure: true,
          tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', checkServerIdentity: (_host, cert) => checkServerIdentity(settings.host, cert) },
          auth: { user: settings.email, pass: settings.password }, logger: false,
          disableAutoIdle: true, disableCompression: true, disableBinary: true,
          connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 7000,
          maxLineLength: 32 * 1024, maxLiteralSize: MAX_BYTES + 1, maxResponseSize: MAX_BYTES + 64 * 1024,
        });
        client.on('error', () => { /* sanitized by the request boundary; never log protocol data */ });
        await client.connect();
        const result = await work(client);
        if (containsCredential(result, settings.password)) throw new ApiError(502, 'The mail server returned unsafe content. No message was imported.', 'imap_unsafe_response');
        return result;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; client?.close(); reject(unavailable()); }, 16000); }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error && typeof error === 'object' && 'authenticationFailed' in error && error.authenticationFailed) throw new ApiError(409, 'The mailbox rejected this login. Disconnect and reconnect with a valid mailbox or app password.', 'imap_auth_failed');
    throw unavailable();
  } finally { stopped = true; clearTimeout(timer); client?.close(); }
}
async function openReadOnly(client: ImapFlow, path: string) {
  const box = await client.mailboxOpen(path, { readOnly: true });
  if (!box || !box.readOnly || !box.uidValidity) throw unavailable();
  return box;
}
export async function verifyImap(settings: ImapSettings, detectSent = false): Promise<string[]> {
  return withMailbox(settings, async client => {
    const folders = [...settings.folders];
    if (detectSent && folders.length === 1 && folders[0] === 'INBOX') {
      const listing = await client.list();
      if (listing.length > 200) throw new ApiError(413, 'This mailbox has too many folders for automatic setup. Use Advanced settings.', 'imap_folder_limit');
      // Trust an explicit server SPECIAL-USE designation, not a guessed folder name.
      const sent = listing.filter(item => item.specialUse === '\\Sent' && item.specialUseSource === 'extension' && !item.flags.has('\\Noselect'));
      if (sent.length === 1 && folder.safeParse(sent[0].path).success && sent[0].path.toLowerCase() !== 'inbox') folders.push(sent[0].path);
    }
    for (const path of folders) await openReadOnly(client, path);
    return folders;
  });
}
export async function searchImap(settings: ImapSettings, email: string, scope: 'recent' | 'all' = 'recent') {
  if (!z.string().email().max(254).safeParse(email).success) throw new ApiError(400, 'This case needs a valid customer email before searching.', 'imap_email_required');
  return withMailbox(settings, async client => {
    const messages: ImapMessage[] = []; let moreAvailable = false; let scanLimited = false;
    for (const path of settings.folders) {
      const box = await openReadOnly(client, path);
      if (!box.exists) continue;
      scanLimited ||= scope === 'recent' && box.exists > MAX_SCAN;
      const found = await client.search({ ...(scope === 'recent' ? { seq: `${Math.max(1, box.exists - MAX_SCAN + 1)}:${box.exists}` } : {}), deleted: false, or: [{ from: email }, { to: email }] }, { uid: true });
      if (!found || !found.length) continue;
      const ids = found.sort((a, b) => b - a).slice(0, 10);
      moreAvailable ||= found.length > 10;
      let count = 0;
      for await (const row of client.fetch(ids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        if (++count > 10 || !ids.includes(row.uid)) throw unavailable();
        // IMAP FROM/TO are substring matches. Confirm exact envelope addresses.
        const addresses = [...(row.envelope?.from || []), ...(row.envelope?.to || [])];
        if (addresses.some(a => a.address?.toLowerCase() === email.toLowerCase())) messages.push(envelopeMessage(box, row));
      }
    }
    messages.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return { messages: messages.slice(0, 10), moreAvailable: moreAvailable || messages.length > 10, scanLimited };
  });
}
export async function parseImapText(source: Buffer): Promise<{ text: string; truncated: boolean }> {
  if (source.length > MAX_BYTES) throw limited();
  const mail = await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, maxHtmlLengthToParse: MAX_BYTES });
  const text = (mail.text || '').replace(/\x00/g, '').trim();
  if (!text) throw new ApiError(422, 'This email has no plain-text body. HTML and attachments are excluded; import a reviewed excerpt manually.', 'imap_plain_text_required');
  return { text: text.slice(0, 20000), truncated: text.length > 20000 };
}
export async function previewImap(settings: ImapSettings, id: string): Promise<ImapPreview> {
  if (!imapMessageId.safeParse(id).success) throw new ApiError(400, 'Choose an email from this case search.', 'invalid_request');
  const [encodedFolder, validity, uidText] = id.split('.');
  const path = Buffer.from(encodedFolder, 'base64url').toString('utf8');
  if (!settings.folders.includes(path)) throw new ApiError(409, 'Search the selected folders again.', 'imap_selection_expired');
  return withMailbox(settings, async client => {
    const box = await openReadOnly(client, path);
    if (String(box.uidValidity) !== validity) throw new ApiError(409, 'The mailbox changed. Search again before previewing.', 'imap_selection_expired');
    const uid = Number(uidText);
    const row = await client.fetchOne(uid, { uid: true, envelope: true, internalDate: true, size: true }, { uid: true });
    if (!row || row.uid !== uid) throw new ApiError(404, 'This email is no longer available.', 'imap_message_missing');
    if (!row.size || row.size > MAX_BYTES) throw limited();
    // ImapFlow uses BODY.PEEK for source fetches. EXAMINE also forbids writes.
    const body = await client.fetchOne(uid, { uid: true, source: { start: 0, maxLength: MAX_BYTES + 1 } }, { uid: true });
    if (!body || body.uid !== uid || !body.source || body.source.length !== row.size) throw limited();
    return { ...envelopeMessage(box, row), ...await parseImapText(body.source) };
  });
}
