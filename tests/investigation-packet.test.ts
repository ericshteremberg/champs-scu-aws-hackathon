import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { TICKET_DEMO_CASES } from '../lib/ticket-demo';

const directories: string[] = [];
const temp = () => { const directory = mkdtempSync(join(tmpdir(), 'causality-packet-test-')); directories.push(directory); return directory; };
const run = (args: string[]) => spawnSync(process.execPath, ['scripts/export-evidence-packet.mjs', ...args], { encoding: 'utf8', timeout: 12000 });
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('offline evidence packet CLI', () => {
  it('exports text and readable HTML with traceable selected sources, never a submission', () => {
    const output = join(temp(), 'packet'); const result = run(['--demo', 'ATM-1042', '--output', output, '--no-screenshots']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    expect(manifest.submitted).toBe(false); expect(manifest.status).toBe('review_required');
    expect(manifest.exhibits.length).toBeGreaterThan(0);
    expect(manifest.exhibits.every((exhibit: { kind: string }) => exhibit.kind === 'source_transcript')).toBe(true);
    const response = readFileSync(join(output, 'submission/response.txt'));
    expect(createHash('sha256').update(response).digest('hex')).toBe(manifest.responseSha256);
    expect(response.toString()).toContain('SYNTHETIC SAMPLE: NOT FOR SUBMISSION');
    expect(manifest.selectedEvidenceIds).not.toContain('case_atm_1042:email');
    const internal = JSON.parse(readFileSync(join(output, 'internal-review/inventory.json'), 'utf8'));
    expect(internal.evidence.length).toBe(11); expect(internal.inventory.coverage).toHaveLength(8);
  });
  it('creates an explicitly incomplete review packet for a contradictory case instead of inventing evidence', () => {
    const output = join(temp(), 'packet'); const result = run(['--demo', 'ATM-1043', '--output', output, '--no-screenshots']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    expect(manifest.appealPolicy).toBe('challenge_all'); expect(manifest.assessment).toBe('mixed');
    expect(manifest.status).toBe('needs_affirmative_evidence'); expect(manifest.exhibits).toEqual([]);
    expect(readFileSync(join(output, 'internal-review/inventory.json'), 'utf8')).toContain('mailbox_unavailable');
    expect(readFileSync(join(output, 'submission/response.txt'), 'utf8')).toContain('NO VERIFIED AFFIRMATIVE SUPPORT SELECTED');
  });
  it('copies a supplied original image without changing its bytes and labels it separately from transcripts', () => {
    const directory = temp(); const image = join(directory, 'original.png');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    writeFileSync(image, bytes);
    const files = join(directory, 'files.json'); writeFileSync(files, JSON.stringify({ 'case_atm_1042:support-3': image }));
    const output = join(directory, 'packet');
    const result = run(['--demo', 'ATM-1042', '--output', output, '--files', files, '--no-screenshots']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    const exhibit = manifest.exhibits.find((value: { evidenceId: string }) => value.evidenceId === 'case_atm_1042:support-3');
    expect(readFileSync(join(output, exhibit.original))).toEqual(bytes);
    expect(exhibit.originalKind).toBe('original_image_supplied_by_operator');
    expect(exhibit.originalSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('rejects cross-case evidence, unselected file IDs and overwriting an existing packet', () => {
    const directory = temp(); const value = structuredClone(TICKET_DEMO_CASES[0]);
    const input = join(directory, 'export.json');
    value.evidence[0].caseId = 'other'; writeFileSync(input, JSON.stringify({ case: value, evidence: value.evidence }));
    expect(run(['--input', input, '--output', join(directory, 'bad'), '--no-screenshots']).status).not.toBe(0);
    const mapping = join(directory, 'files.json'); writeFileSync(mapping, JSON.stringify({ 'foreign-source': '/tmp/unrelated-file' }));
    expect(run(['--demo', 'ATM-1042', '--output', join(directory, 'bad-map'), '--files', mapping, '--no-screenshots']).status).not.toBe(0);
    const output = join(directory, 'packet');
    expect(run(['--demo', 'ATM-1042', '--output', output, '--no-screenshots']).status).toBe(0);
    expect(run(['--demo', 'ATM-1042', '--output', output, '--no-screenshots']).status).not.toBe(0);
  });
  it('escapes source HTML and never treats an imported human response as code-verified prose', () => {
    const directory = temp(); const value = structuredClone(TICKET_DEMO_CASES[0]);
    value.evidence.find(record => record.id.endsWith('support-3'))!.title = '<img src=x onerror=alert(1)>';
    const input = join(directory, 'export.json'); writeFileSync(input, JSON.stringify({ case: value, evidence: value.evidence, draft: { content: 'Unverified human claim.', status: 'approved' } }));
    const output = join(directory, 'packet'); const result = run(['--input', input, '--output', output, '--no-screenshots']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(output, 'submission/report.html'), 'utf8')).not.toContain('<img src=x');
    expect(readFileSync(join(output, 'submission/response.txt'), 'utf8')).not.toContain('Unverified human claim');
    expect(readFileSync(join(output, 'internal-review/inventory.json'), 'utf8')).toContain('Unverified human claim');
    expect(readdirSync(join(output, 'submission/exhibits')).every(name => name.endsWith('.txt'))).toBe(true);
  });
});
