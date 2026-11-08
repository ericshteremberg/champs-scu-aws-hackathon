import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CaseRecord, InvestigationRun } from '../shared/types.js';

export class Store {
  private db: DatabaseSync;
  constructor(path: string, seeds: CaseRecord[] = []) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), started_at TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runs_case ON runs(case_id, started_at);');
    for (const item of seeds) this.db.prepare('INSERT OR IGNORE INTO cases(id,data) VALUES (?,?)').run(item.id, JSON.stringify(item));
    for (const row of this.db.prepare('SELECT data FROM runs').all()) {
      const run = JSON.parse(String(row.data)) as InvestigationRun;
      if (run.status === 'running') {
        run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = 'The server restarted before this investigation finished. Start a new investigation.';
        this.saveRun(run);
        const item = this.getCase(run.caseId);
        if (item?.latestRunId === run.id) { item.status = 'needs_review'; this.saveCase(item); }
      }
    }
  }
  listCases(): CaseRecord[] { return this.db.prepare('SELECT data FROM cases ORDER BY id').all().map(row => JSON.parse(String(row.data))); }
  getCase(id: string): CaseRecord | undefined { const row = this.db.prepare('SELECT data FROM cases WHERE id=?').get(id); return row ? JSON.parse(String(row.data)) : undefined; }
  saveCase(item: CaseRecord) { this.db.prepare('INSERT INTO cases(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, JSON.stringify(item)); }
  getRun(id: string): InvestigationRun | undefined { const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id); return row ? JSON.parse(String(row.data)) : undefined; }
  saveRun(run: InvestigationRun) { this.db.prepare('INSERT INTO runs(id,case_id,started_at,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id, run.caseId, run.startedAt, JSON.stringify(run)); }
  close() { this.db.close(); }
}
