import { parseDocument, DomUtils } from 'htmlparser2';
import { ApiError } from './types.ts';

const hosts = new Set(['pay.stripe.com', 'dashboard.stripe.com', 'files.stripe.com', 'invoice.stripe.com']);
function allowed(value: string | URL) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port || url.hash) throw new ApiError(502, 'Stripe returned an unsupported receipt download address.', 'receipt_url_invalid');
  return url;
}
async function download(value: string, limit: number, request: typeof fetch) {
  let url = allowed(value);
  for (let hop = 0; hop < 5; hop++) {
    // Signed customer receipt links need no OAuth header. Never forward credentials to file hosts.
    const response = await request(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new ApiError(502, 'Stripe returned an incomplete receipt redirect.');
      url = allowed(new URL(location, url)); continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new ApiError(502, 'The original Stripe receipt is currently unavailable.', 'receipt_unavailable'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > limit) throw new ApiError(413, 'The original Stripe receipt exceeds the download limit.');
        chunks.push(next.value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    return { bytes: Buffer.concat(chunks), url };
  }
  throw new ApiError(502, 'Stripe receipt redirects did not finish.');
}

/** Follows the actual Download receipt link, never generates a receipt from model text. */
export async function fetchStripeReceiptPdf(receiptUrl: string, request: typeof fetch = fetch): Promise<Uint8Array> {
  if (allowed(receiptUrl).hostname !== 'pay.stripe.com') throw new ApiError(502, 'Stripe returned an unsupported hosted receipt.');
  const page = await download(receiptUrl, 1024 * 1024, request);
  const document = parseDocument(page.bytes.toString('utf8'));
  const links = DomUtils.getElementsByTagName('a', document).filter(node => DomUtils.textContent(node).replace(/\s+/g, ' ').trim().toLowerCase() === 'download receipt');
  if (links.length !== 1 || !links[0].attribs.href) throw new ApiError(502, 'Stripe did not provide an original receipt download.', 'receipt_download_missing');
  const target = allowed(new URL(links[0].attribs.href, page.url));
  const result = await download(target.href, 10 * 1024 * 1024, request);
  if (result.bytes.subarray(0, 5).toString() !== '%PDF-') throw new ApiError(502, 'Stripe did not return a PDF receipt.', 'receipt_format_invalid');
  return new Uint8Array(result.bytes);
}
