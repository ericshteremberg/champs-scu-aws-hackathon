import type { Evidence } from '../domain.ts';
import { z } from 'zod';
const schema = z.object({ schemaVersion: z.literal(1), provider: z.literal('policy-library'), policyId: z.string(), capturedAt: z.string().datetime(), effectiveDate: z.string(), text: z.string().max(24000) });
/** A labeled text capture, never an imitation historical checkout screenshot. */
export async function renderOriginalPolicy(bytes: Uint8Array, record: Evidence): Promise<Uint8Array> {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const snapshot = record.mimeType === 'application/json' ? schema.parse(JSON.parse(raw)) : null;
  if (snapshot && (snapshot.policyId !== record.originalPolicy?.policyId || snapshot.effectiveDate !== record.originalPolicy.effectiveDate || snapshot.capturedAt !== record.capturedAt)) throw new Error('The policy capture does not match this source.');
  const text = snapshot?.text ?? raw;
  const canvas = document.createElement('canvas'); canvas.width = 900;
  const ctx = canvas.getContext('2d')!; ctx.font = '16px Arial';
  const lines: string[] = [];
  const add = (value: string) => { for (const paragraph of value.split('\n')) { let line = ''; for (const char of paragraph) { if (ctx.measureText(line + char).width > 820) { lines.push(line); line = ''; } line += char; } lines.push(line); } };
  add('RETAINED POLICY TEXT');
  add(`Collected: ${record.capturedAt}\nDeclared effective date: ${record.originalPolicy?.effectiveDate}\n`);
  add('Text export of the retained source, not a checkout screenshot.');
  add('The original file is embedded. Historical disclosure and acceptance are unverified.\n');
  // Large policies retain their full bytes. The visual preview is explicitly labeled.
  add(text.slice(0, 24000));
  const clipped = lines.length > 450 || text.length > 24000;
  if (lines.length > 450) lines.splice(450);
  if (clipped) lines.push('', 'VISUAL EXCERPT: remainder is available in the embedded original file.');
  canvas.height = 56 + lines.length * 24;
  const draw = canvas.getContext('2d')!; draw.fillStyle = '#fff'; draw.fillRect(0, 0, canvas.width, canvas.height); draw.fillStyle = '#111'; draw.font = '16px Arial';
  lines.forEach((line, i) => draw.fillText(line, 32, 36 + i * 24));
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(new Error('Policy visual export failed.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
