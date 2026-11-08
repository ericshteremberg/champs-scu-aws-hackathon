import type { DisputeCase, Evidence } from '../domain.ts';
import { isCategoryDiagnostic, reviewNotes } from '../investigation/sections.ts';

/** Legacy imported reasons may contain operator instructions after the provider code. */
export function packetClaim(item: DisputeCase): string {
  return item.reason.match(/^Stripe reason:\s*([^\n.]+)(?:\.|$)/i)?.[1]?.trim() || item.reason;
}
export function packetSources(item: DisputeCase): Evidence[] {
  return [...item.evidence].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
export function citationText(text: string, sources: Evidence[]): string {
  const labels = new Map(sources.map((record, i) => [record.id, `E${i + 1}`]));
  return text.replace(/(?<!\\)\[([^\]\n]+)\]/g, (original, id: string) => labels.has(id) ? `[${labels.get(id)}]` : original);
}
export function packetResponse(item: DisputeCase, content = item.draft?.content ?? ''): string {
  // The investigator appends internal source notes. Keep them in the workspace.
  // Preserve the saved factual narrative and edits, including its adverse statements.
  const [response, ...tails] = content.split('\n\nSOURCE LIMITATIONS\n');
  const retainedEdits = tails.join('\n').split('\n').filter(line => line.trim() && !line.startsWith('- '));
  const body = [response, ...retainedEdits].join('\n\n');
  return citationText(item.draft?.method === 'evidence_template' ? body.replace(/\[(\d+)\]/g, '[E$1]') : body, packetSources(item)).replace(/\*\*([^*]+)\*\*/g, '$1');
}
/** Include every case source. Only explicitly labeled, uncited analyst notes stay internal. */
export function packetIncludedSources(item: DisputeCase, content = item.draft?.content ?? ''): Evidence[] {
  const sources = packetSources(item);
  const response = packetResponse(item, content);
  const labels = new Set([...response.matchAll(/(?<!\\)\[E(\d+)\]/g)].map(match => Number(match[1])));
  return sources.filter((record, index) => labels.has(index + 1) || Boolean(record.fileName && record.downloadUrl) || !(record.source === 'manual' && /^Analyst review\b/i.test(record.reference || '')));
}
export function packetNotes(item: DisputeCase): string[] {
  const appended = item.draft?.content.split('\n\nSOURCE LIMITATIONS\n')[1]?.split('\n').filter(line => line.startsWith('- ')).map(line => line.replace(/^- /, '')) ?? [];
  return reviewNotes([
    ...(item.draft?.analysis?.gaps ?? []), ...appended,
    ...item.evidence.flatMap(record => record.provenance?.limitations ?? []),
    ...item.findings.filter(finding => finding.kind === 'missing' || finding.kind === 'conflict').map(finding => `${finding.title}: ${finding.detail}`),
  ]);
}
export function categoryDiagnostics(item: DisputeCase): string[] {
  return [...new Set(item.draft?.analysis?.gaps.filter(isCategoryDiagnostic) ?? [])];
}
export function assertPacketReady(item: DisputeCase) {
  if (!item.draft?.content.trim()) throw new Error('Prepare a response before downloading the evidence PDF.');
  if (item.draft.sourceStale) throw new Error('Evidence changed. Prepare a fresh report before downloading the PDF.');
  if (item.investigation?.status === 'running') throw new Error('Wait for the investigation to finish before downloading the PDF.');
  const ids = new Set(item.evidence.map(record => record.id));
  const texts = [item.draft.content, ...packetNotes(item), ...item.findings.flatMap(finding => [finding.title, finding.detail])];
  const unknown = texts.some(text => [...text.matchAll(/(?<!\\)\[(ev_[^\]\n]+)\]/g)].some(match => !ids.has(match[1])));
  if (unknown || item.findings.some(finding => finding.evidenceIds.some(id => !ids.has(id)))) {
    throw new Error('A cited source is no longer attached. Prepare a fresh report before downloading the PDF.');
  }
}
export const packetFilename = (item: DisputeCase) => `causality-${(item.orderRef || item.id).replace(/[^a-zA-Z0-9-]/g, '') || 'case'}-evidence.pdf`;
