import { z } from 'zod';
import type { Evidence } from '../domain.ts';
const snapshotSchema = z.object({ schemaVersion: z.literal(1), provider: z.literal('supabase'), caseId: z.string(), projectRef: z.string(), table: z.string(), capturedAt: z.string().datetime(), query: z.object({ sql: z.string().max(4000), parameters: z.array(z.string().max(200)).max(10) }), rows: z.array(z.record(z.string().max(63), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]))).max(6) });

/** A faithful visual export of original returned rows, not an imitation dashboard screenshot. */
export async function renderOriginalRows(bytes: Uint8Array, record: Evidence): Promise<Uint8Array> {
  const snapshot = snapshotSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (snapshot.caseId !== record.caseId || snapshot.projectRef !== record.originalRows?.projectRef || snapshot.table !== record.originalRows.table || snapshot.rows.length !== record.originalRows.rowCount) throw new Error('The original database result does not match this case source.');
  if (snapshot.rows.some(row => Object.keys(row).length > 8)) throw new Error('Too many columns in the original database result.');
  const canvas = document.createElement('canvas'); canvas.width = 900;
  const measure = canvas.getContext('2d')!; measure.font = '16px monospace';
  const lines: { text: string; heading: boolean }[] = [];
  const add = (text: string, heading = false) => {
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const char of paragraph) { if (measure.measureText(line + char).width > 820) { lines.push({ text: line, heading }); line = ''; } line += char; }
      lines.push({ text: line, heading });
    }
  };
  add('ORIGINAL DATABASE QUERY RESULT | SUPABASE', true);
  add(`Project: ${snapshot.projectRef}\nTable: public.${snapshot.table}\nCollected: ${snapshot.capturedAt}\nRows returned: ${snapshot.rows.length}`);
  add('Visual export of returned rows, not a dashboard screenshot.');
  add('Original JSON, query and parameters are embedded in the PDF.\n');
  add('QUERY', true); add(snapshot.query.sql); add(`Parameters: ${JSON.stringify(snapshot.query.parameters)}\n`);
  snapshot.rows.forEach((row, i) => { add(`ROW ${i + 1}`, true); for (const [field, value] of Object.entries(row)) add(`${field}: ${JSON.stringify(value)}`); add(''); });
  if (!snapshot.rows.length) add('No matching rows were returned by this scoped query. This does not establish that an event did not occur.');
  canvas.height = 56 + lines.length * 24;
  if (canvas.height > 12000) throw new Error('The database result exceeds the visual page limit. Inspect the retained original JSON.');
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  lines.forEach((line, i) => { ctx.fillStyle = line.heading ? '#bb4b0c' : '#172333'; ctx.font = '16px monospace'; ctx.fillText(line.text, 32, 36 + i * 24); });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Database visual export failed.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
