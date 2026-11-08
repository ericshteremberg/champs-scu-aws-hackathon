import { hashBytes, visualEvidence, visualMime, type Exhibit, PACKET_FILE_LIMIT, FILE_LIMIT } from './exhibits.ts';
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { DisputeCase } from '../domain.ts';
import { formatMoney } from '../money.ts';
import { assertPacketReady, packetClaim, packetIncludedSources, packetResponse, packetSources } from './packet.ts';

type Fonts = { regular: Uint8Array; bold: Uint8Array };
const ink = rgb(0.09, 0.14, 0.21), muted = rgb(0.35, 0.39, 0.44), accent = rgb(0.91, 0.36, 0.07), rule = rgb(0.85, 0.87, 0.89);
const stamp = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : `${parsed.toISOString().slice(0, 10)} ${parsed.toISOString().slice(11, 16)} UTC`;
};

/** All inputs are already authorized case data. No provider calls or case mutations. */
export async function createEvidencePdf(item: DisputeCase, fonts: Fonts, generatedAt = new Date(), exhibits: Exhibit[] = []): Promise<Uint8Array> {
  assertPacketReady(item);
  const expected = visualEvidence(item);
  if (exhibits.length !== expected.length || new Set(exhibits.map(e => e.evidenceId)).size !== exhibits.length || exhibits.some(e => !expected.some(record => record.id === e.evidenceId))) throw new Error('Original exhibits are missing or do not belong to this case. Collect the attached files before exporting.');
  let fileBytes = 0;
  for (const exhibit of exhibits) {
    const record = expected.find(record => record.id === exhibit.evidenceId)!;
    fileBytes += exhibit.bytes.length + (exhibit.original?.bytes.length ?? 0);
    if (exhibit.bytes.length > FILE_LIMIT || fileBytes > PACKET_FILE_LIMIT || visualMime(exhibit.bytes) !== exhibit.mimeType) throw new Error('An original exhibit exceeds the supported size or format.');
    if (await hashBytes(exhibit.bytes) !== exhibit.sha256) throw new Error('An exhibit changed during PDF preparation.');
    const originalHash = exhibit.original ? await hashBytes(exhibit.original.bytes) : exhibit.sha256;
    if ((record.fileSha256 && record.fileSha256 !== originalHash) || (exhibit.original && originalHash !== exhibit.original.sha256)) throw new Error('An original exhibit differs from its captured fingerprint.');
    if (Boolean(record.originalEmail) !== Boolean(exhibit.renderedEmail) || (record.originalEmail && !exhibit.original)) throw new Error('An email exhibit has no retained original source.');
    if (Boolean(record.originalRows) !== Boolean(exhibit.renderedRows) || (record.originalRows && !exhibit.original)) throw new Error('A database exhibit has no retained original query result.');
  }
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([doc.embedFont(fonts.regular, { subset: true }), doc.embedFont(fonts.bold, { subset: true })]);
  doc.setTitle(`Evidence packet | ${item.orderRef || item.id}`);
  doc.setAuthor('Causality'); doc.setCreator('Causality evidence packet'); doc.setCreationDate(generatedAt);
  const width = 612, height = 792, margin = 48, usable = width - margin * 2;
  let page: PDFPage, y = 0, section = 'Dispute evidence', encodedFallback = false;
  const glyphs = new Set(regular.getCharacterSet());
  const safe = (text: string) => [...text.normalize('NFC').replace(/[\u2010-\u2015]/g, '-').replace(/\t/g, '  ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')].map(char => {
    if (char === '\n' || glyphs.has(char.codePointAt(0)!)) return char;
    encodedFallback = true;
    return `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`;
  }).join('');
  const lines = (text: string, font: PDFFont, size: number): string[] => {
    const result: string[] = [];
    for (const paragraph of safe(text).split('\n')) {
      if (!paragraph.trim()) { result.push(''); continue; }
      let line = '';
      for (const word of paragraph.trim().split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= usable) { line = next; continue; }
        if (line) result.push(line);
        line = '';
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > usable) { result.push(line); line = ''; }
          line += char;
        }
      }
      if (line) result.push(line);
    }
    return result;
  };
  const newPage = () => {
    page = doc.addPage([width, height]);
    page.drawRectangle({ x: margin, y: height - 43, width: 18, height: 4, color: accent });
    page.drawText('CAUSALITY', { x: margin + 27, y: height - 44, size: 10, font: bold, color: ink });
    page.drawText(section, { x: margin, y: height - 67, size: 9, font: regular, color: muted });
    page.drawLine({ start: { x: margin, y: height - 79 }, end: { x: width - margin, y: height - 79 }, color: rule, thickness: 0.6 });
    y = height - 106;
  };
  const ensure = (space: number) => { if (y - space < 62) newPage(); };
  const write = (text: string, size = 10.5, font = regular, color = ink, after = 10, leading = 1.45) => {
    for (const line of lines(text, font, size)) {
      ensure(size * leading);
      if (line) page.drawText(line, { x: margin, y, size, font, color });
      y -= size * leading;
    }
    y -= after;
  };
  const heading = (text: string) => { ensure(65); write(text, 15, bold, ink, 11); };
  const sources = packetSources(item);
  newPage();
  write('Response to chargeback', 22, bold, ink, 8);
  write(item.source === 'demo' ? 'SYNTHETIC SAMPLE | NOT FOR SUBMISSION' : item.draft!.status === 'approved' ? 'REVIEWED COPY | NOT SUBMITTED' : 'DRAFT FOR REVIEW | NOT SUBMITTED', 8, bold, accent, 12);
  write(`${item.customerName} | ${formatMoney(item.amount, item.currency)} | Order ${item.orderRef || 'Not recorded'}`, 11, bold, ink, 5);
  if (item.stripeDisputeId) write(`Dispute ${item.stripeDisputeId}`, 8.5, regular, muted, 4);
  write(`Prepared ${stamp(generatedAt.toISOString())}`, 8.5, regular, muted, 12);
  write(`Disputed claim: ${packetClaim(item)}`, 10, regular, ink, 14);
  heading('Merchant response');
  // Do not truncate or strip adverse statements from the saved factual narrative.
  write(packetResponse(item), 10.5);

  const included = packetIncludedSources(item);
  section = 'Evidence index'; ensure(65); heading('Supporting records');
  for (const record of included) {
    const index = sources.findIndex(source => source.id === record.id);
    ensure(44);
    write(`[E${index + 1}] ${record.title}`, 9, bold, ink, 2);
    write(`${stamp(record.occurredAt)} | ${record.reference || record.id}`, 8, regular, muted, 2);
    write(exhibits.some(e => e.evidenceId === record.id) ? 'Original exhibit attached.' : 'Saved source record.', 8, regular, muted, 6);
  }
  if (!included.length) write('No supporting records are cited in this response.', 9);
  let visualPages = 0;
  for (const exhibit of exhibits) {
    const index = sources.findIndex(record => record.id === exhibit.evidenceId), record = sources[index];
    const original = exhibit.original?.bytes ?? exhibit.bytes;
    await doc.attach(original, `E${index + 1}-${record.fileName || 'original'}`, { mimeType: exhibit.original?.mimeType ?? exhibit.mimeType, description: `Original source for E${index + 1}. SHA-256 ${exhibit.original?.sha256 ?? exhibit.sha256}` });
    const exhibitHeader = (part: string) => {
      if (++visualPages > 100) throw new Error('Visual exhibits exceed 100 pages. Narrow the case files.');
      section = 'Visual exhibits'; newPage();
      heading(`[E${index + 1}] ${record.title}`);
      write(`${exhibit.renderedEmail ? 'Rendered original Resend email' : exhibit.renderedRows ? 'Original Supabase query result' : record.originalDocument ? 'Original Stripe receipt PDF' : 'Original uploaded file'} | ${part}`, 9, bold, accent, 5);
      write(`Collected: ${record.capturedAt ? stamp(record.capturedAt) : 'Not recorded'} | Retrieved for export: ${stamp(exhibit.fetchedAt)}`, 8, regular, muted, 4);
      write(`Source SHA-256: ${exhibit.original?.sha256 ?? exhibit.sha256}`, 7.5, regular, muted, 4);
      write(exhibit.renderedEmail ? 'Captured provider body, not a provider-dashboard screenshot. Remote images, stylesheets and active content omitted.' : exhibit.renderedRows ? 'Visual export of original returned rows. The original JSON, query and parameters are embedded. This is not a database dashboard screenshot.' : record.originalDocument ? 'Original provider-generated PDF retrieved through the connected Stripe charge. The unmodified file is embedded.' : 'Reproduction of the attached original. Uploader-supplied content is not independently authenticated.', 8, regular, muted, 8);
      if (!record.fileSha256) write('No fingerprint was recorded at collection; the displayed hash was computed for this export.', 8, regular, muted, 5);
    };
    if (exhibit.mimeType === 'application/pdf') {
      const originalDoc = await PDFDocument.load(exhibit.bytes);
      if (originalDoc.getPageCount() > 50 || !originalDoc.getPageCount()) throw new Error('Each original PDF must contain between 1 and 50 pages.');
      if (originalDoc.getForm().getFields().length) throw new Error('A fillable original PDF needs a flattened visual copy before it can be included. Keep its original attached.');
      const embedded = await doc.embedPdf(originalDoc, originalDoc.getPageIndices());
      for (const [number, originalPage] of embedded.entries()) {
        if (++visualPages > 100) throw new Error('Visual exhibits exceed 100 pages. Narrow the case files.');
        page = doc.addPage([width, height]);
        page.drawText(`[E${index + 1}] Original document | Page ${number + 1} of ${embedded.length}`, { x: margin, y: height - 22, size: 8, font: bold, color: muted });
        page.drawText(`Source SHA-256: ${exhibit.sha256}`, { x: margin, y: height - 35, size: 6.5, font: regular, color: muted });
        page.drawText(`Collected: ${record.capturedAt ? stamp(record.capturedAt) : 'Not recorded'} | Original file embedded`, { x: margin, y: height - 47, size: 7, font: regular, color: muted });
        const scale = Math.min((width - 32) / originalPage.width, (height - 108) / originalPage.height);
        page.drawPage(originalPage, { x: (width - originalPage.width * scale) / 2, y: 52, width: originalPage.width * scale, height: originalPage.height * scale });
      }
    } else {
      if (exhibit.mimeType === 'image/png') {
        const data = new DataView(exhibit.bytes.buffer, exhibit.bytes.byteOffset, exhibit.bytes.byteLength);
        if (data.byteLength < 24 || data.getUint32(16) * data.getUint32(20) > 20000000) throw new Error('An original image exceeds the 20-megapixel visual limit.');
      }
      const originalImage = exhibit.mimeType === 'image/png' ? await doc.embedPng(exhibit.bytes) : await doc.embedJpg(exhibit.bytes);
      if (!originalImage.width || !originalImage.height || originalImage.width * originalImage.height > 20000000) throw new Error('An original image has unsupported dimensions.');
      const scale = Math.min(1, usable / originalImage.width), imageHeight = originalImage.height * scale;
      let offset = 0, slice = 0;
      while (offset < imageHeight) {
        exhibitHeader(`Image segment ${++slice}`);
        const available = y - 68, shown = Math.min(available, imageHeight - offset);
        if (available < 100) throw new Error('The exhibit metadata leaves too little space for its image.');
        page!.pushOperators(pushGraphicsState(), rectangle(margin, y - shown, usable, shown), clip(), endPath());
        page!.drawImage(originalImage, { x: margin + (usable - originalImage.width * scale) / 2, y: y - imageHeight + offset, width: originalImage.width * scale, height: imageHeight });
        page!.pushOperators(popGraphicsState());
        offset += shown;
      }
    }
  }
  // Preserve all retained source text that is not already reproduced as an original exhibit.
  // Keep a compact appendix, without repeating provenance checklists or internal review notes.
  const textSources = included.filter(record => !exhibits.some(exhibit => exhibit.evidenceId === record.id));
  if (textSources.length) {
    section = 'Supporting source records'; newPage();
    write('Supporting source records', 18, bold, ink, 12);
    write('Saved source text is reproduced below. Original files, where retained, appear in the preceding exhibits.', 9, regular, muted, 12);
    for (const record of textSources) {
      const index = sources.findIndex(source => source.id === record.id);
      ensure(85);
      write(`[E${index + 1}] ${record.title}`, 11, bold, ink, 3);
      write(`${stamp(record.occurredAt)} | ${record.reference || record.id}`, 8, regular, muted, 7);
      write(record.content || 'No extracted text is available. Inspect the source record in the case.', 9.5, regular, ink, 12, 1.3);
    }
  }
  if (encodedFallback) write('Typography note: characters outside the embedded font are represented by their Unicode code points, such as [U+1F600]. Original source text remains available in the case.', 9, regular, muted);
  const pages = doc.getPages();
  pages.forEach((value, index) => {
    value.drawLine({ start: { x: margin, y: 44 }, end: { x: width - margin, y: 44 }, color: rule, thickness: 0.6 });
    value.drawText('Confidential | Merchant review | Not submitted', { x: margin, y: 29, size: 8, font: regular, color: muted });
    const number = `${index + 1} / ${pages.length}`;
    value.drawText(number, { x: width - margin - regular.widthOfTextAtSize(number, 8), y: 29, size: 8, font: regular, color: muted });
  });
  return doc.save();
}
