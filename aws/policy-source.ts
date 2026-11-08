import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { convert } from 'html-to-text';
import { getDocumentProxy } from 'unpdf';
import { publicAddress, validatePublicMerchantUrl } from './merchant-network.ts';
import { ApiError } from './types.ts';

/** Public HTTPS only. DNS is checked and pinned for each hop, with no cookies or credentials. */
export async function fetchPolicyUrl(raw: string): Promise<{ url: string; bytes: Uint8Array; mimeType: string }> {
  let url = new URL(raw); const deadline = AbortSignal.timeout(12000);
  for (let hop = 0; hop < 4; hop++) {
    try { validatePublicMerchantUrl(`${url.origin}${url.pathname}`); } catch { throw new ApiError(400, 'Use a public HTTPS policy URL on port 443, without credentials.', 'policy_url_blocked'); }
    if (url.username || url.password || url.hash || raw.length > 2048) throw new ApiError(400, 'Remove credentials and fragments from the policy URL.', 'policy_url_blocked');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([lookup(host, { all: true }), new Promise<never>((_, reject) => deadline.addEventListener('abort', () => reject(new ApiError(408, 'Policy lookup timed out.')), { once: true }))]);
    if (deadline.aborted) throw new ApiError(408, 'Policy lookup timed out.');
    if (!answers.length || answers.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw new ApiError(400, 'Policy URLs must resolve only to public internet addresses.', 'policy_url_blocked');
    const chosen = answers.find(a => a.family === 4) || answers[0];
    const result = await new Promise<{ status: number; location?: string; bytes: Uint8Array; mimeType: string }>((resolve, reject) => {
      const req = request({ hostname: host, servername: isIP(host) ? undefined : host, port: 443, path: `${url.pathname}${url.search}`, method: 'GET', agent: false, rejectUnauthorized: true, signal: deadline, maxHeaderSize: 16384,
        headers: { Accept: 'text/html,text/plain,application/pdf', 'Accept-Encoding': 'identity' },
        lookup: (_host, options, cb) => options.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family),
      }, res => {
        const chunks: Buffer[] = []; let total = 0;
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); reject(new ApiError(422, 'The policy server must provide an uncompressed response. Upload the document instead.')); return; }
        res.on('data', (chunk: Buffer) => { total += chunk.length; if (total > 2 * 1024 * 1024) { res.destroy(); reject(new ApiError(413, 'The policy URL exceeds 2 MB. Upload the document instead.')); } else chunks.push(chunk); });
        res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode || 0, location: res.headers.location, bytes: Buffer.concat(chunks), mimeType: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase() }));
      }); req.on('error', reject); req.end();
    });
    if (result.status >= 300 && result.status < 400 && result.location) { url = new URL(result.location, url); continue; }
    if (result.status !== 200) throw new ApiError(422, 'The policy page could not be retrieved. Use a public URL or upload its original document.');
    if (!['text/html', 'text/plain', 'application/pdf'].includes(result.mimeType)) throw new ApiError(422, 'Use an HTML, text or PDF policy URL.');
    return { ...result, url: url.toString() };
  }
  throw new ApiError(422, 'The policy URL has too many redirects.');
}
export async function policyText(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { useSystemFonts: false, disableFontFace: true });
    try {
      if (pdf.numPages > 50) throw new ApiError(422, 'Policy PDFs support up to 50 pages.');
      const parts: string[] = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        const text = await (await pdf.getPage(page)).getTextContent();
        parts.push(text.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
        if (parts.join('\n').length > 24000) break;
      }
      const all = parts.join('\n\n').trim();
      return { text: all.slice(0, 24000), notice: all.length > 24000 ? 'Extracted text is limited to 24,000 characters. Review the full original PDF.' : all.length < 10 ? 'No searchable text was found. The original is retained; add a text transcription as another version for clause search.' : undefined };
    } finally { await pdf.loadingTask.destroy(); }
  }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const text = mimeType === 'text/html' ? convert(raw, { wordwrap: false, selectors: [{ selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }, { selector: 'nav', format: 'skip' }, { selector: 'img', format: 'skip' }] }) : raw;
  return { text: text.trim().slice(0, 24000), notice: text.length > 24000 ? 'Text preview is limited to 24,000 characters. The complete source is retained.' : undefined };
}
