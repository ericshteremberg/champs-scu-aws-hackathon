import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { DisputeCase } from '../domain.ts';
import { formatMoney } from '../money.ts';
import { assertPacketReady, citationText, packetNotes, packetResponse, packetSources } from './packet.ts';

type Fonts = { regular: Uint8Array; bold: Uint8Array };
const ink = rgb(0.09, 0.14, 0.21), muted = rgb(0.35, 0.39, 0.44), accent = rgb(0.91, 0.36, 0.07), rule = rgb(0.85, 0.87, 0.89);
const stamp = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : `${parsed.toISOString().slice(0, 10)} ${parsed.toISOString().slice(11, 16)} UTC`;
};

/** All inputs are already authorized case data. No provider calls or case mutations. */
export async function createEvidencePdf(item: DisputeCase, fonts: Fonts, generatedAt = new Date()): Promise<Uint8Array> {
  assertPacketReady(item);
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
  const write = (text: string, size = 10.5, font = regular, color = ink, after = 10) => {
    for (const line of lines(text, font, size)) {
      ensure(size * 1.45);
      if (line) page.drawText(line, { x: margin, y, size, font, color });
      y -= size * 1.45;
    }
    y -= after;
  };
  const heading = (text: string) => { ensure(65); write(text, 15, bold, ink, 11); };
  const sources = packetSources(item);
  const render = (text: string) => citationText(text, sources);
  newPage();
  write('Dispute evidence packet', 27, bold, ink, 9);
  write(item.source === 'demo' ? 'SYNTHETIC SAMPLE | NOT FOR SUBMISSION' : item.draft!.status === 'approved' ? 'REVIEWED COPY | NOT SUBMITTED' : 'DRAFT FOR REVIEW | NOT SUBMITTED', 9, bold, accent, 17);
  write(item.title, 15, bold, ink, 14);
  write(`Customer: ${item.customerName}\nOrder: ${item.orderRef || 'Not recorded'}\nAmount disputed: ${formatMoney(item.amount, item.currency)}\nResponse due: ${stamp(item.dueAt)}`, 10.5);
  if (item.stripeDisputeId) write(`Dispute reference: ${item.stripeDisputeId}`, 9, regular, muted);
  write(`Prepared ${stamp(generatedAt.toISOString())} | Revision ${item.draft!.revision} | ${sources.length} source records`, 9, regular, muted, 14);
  write(item.draft!.status === 'approved' ? `Reviewed ${stamp(item.draft!.approvedAt ?? item.draft!.generatedAt)} by ${item.draft!.approvedBy || 'workspace reviewer'}.` : 'Prepared for merchant review. Downloading does not approve or submit this response.', 9, regular, muted);
  heading('Dispute context');
  write(item.reason);
  heading('Merchant response');
  write(packetResponse(item));

  section = 'Evidence register'; y -= 18; ensure(160); heading('Evidence register');
  write('References [E1], [E2], and onward identify the source records reproduced in the appendix. The packet includes saved case records; it does not independently verify their contents.', 10, regular, muted, 18);
  for (const [index, record] of sources.entries()) {
    ensure(70); write(`[E${index + 1}] ${record.title}`, 11, bold, ink, 3);
    write(`${stamp(record.occurredAt)} | ${record.source}${record.provenance ? ` | ${record.provenance.sourceMode}` : ' | saved case record'}`, 9, regular, muted, 5);
    write(`Reference: ${record.reference || record.id}`, 9, regular, muted, 12);
  }
  if (!sources.length) write('No source records are attached. This draft cannot substantiate a dispute response.');

  const notes = packetNotes(item);
  if (notes.length) {
    section = 'Review notes'; newPage(); heading('Material limitations and review notes');
    write('These notes qualify the response and remain part of this review packet.', 10, regular, muted, 16);
    for (const note of notes) write(`- ${render(note)}`, 10);
  }
  section = 'Source appendix'; newPage();
  for (const [index, record] of sources.entries()) {
    ensure(150);
    heading(`[E${index + 1}] ${record.title}`);
    write(`${stamp(record.occurredAt)} | ${record.source}`, 9, regular, muted, 5);
    write(`Reference: ${record.reference || record.id}`, 9, regular, muted, 5);
    write(`Record ID: ${record.id}`, 8, regular, muted, 15);
    write(record.content || 'No extracted text is available. Inspect the original attachment.', 10);
    if (record.fileName || record.downloadUrl) write(`Original attachment: ${record.fileName || 'Attached file'}. The original file is available in the case and is not embedded in this PDF.`, 9, regular, muted);
    for (const limitation of record.provenance?.limitations ?? []) write(`Source qualification: ${limitation}`, 9, regular, muted);
    y -= 18;
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
