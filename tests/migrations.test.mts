import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';

const initialMigration = readFileSync(new URL('../drizzle/0000_fluffy_hardball.sql', import.meta.url), 'utf8');
const investigationMigration = readFileSync(new URL('../drizzle/0001_aws_investigations.sql', import.meta.url), 'utf8');

function initialDatabase(context: TestContext) {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
  db.exec(initialMigration);
  db.exec(`INSERT INTO workspaces(id,owner_id,name,created_at,updated_at) VALUES('ws','owner','Workspace','2026-11-07','2026-11-07');
    INSERT INTO cases(id,workspace_id,title,customer_name,amount,reason,due_at,source,created_at,updated_at)
    VALUES('case','ws','Ticket not received','Customer',5000,'product_not_received','2026-11-30','demo','2026-11-07','2026-11-07');`);
  return db;
}

function revision(db: DatabaseSync, caseId = 'case') {
  return db.prepare('SELECT data_revision FROM cases WHERE id = ?').get(caseId)!.data_revision;
}

function addEvidence(db: DatabaseSync) {
  db.exec(`INSERT INTO evidence(id,workspace_id,case_id,source,title,content,occurred_at,reference,created_at)
    VALUES('record','ws','case','database','Ticket issued','Issued before the event','2026-11-01','ticket_123','2026-11-07');`);
}

test('investigation migration upgrades existing cases, approvals and attachments without rewriting them', context => {
  const db = initialDatabase(context);
  addEvidence(db);
  db.exec(`UPDATE evidence SET file_key='private/original.pdf',file_name='original.pdf',mime_type='application/pdf' WHERE id='record';
    INSERT INTO drafts(case_id,workspace_id,content,status,generated_at,approved_at,approved_by,revision)
    VALUES('case','ws','Reviewed response','approved','2026-11-06','2026-11-07','owner',3);`);
  db.exec(investigationMigration);
  assert.equal(revision(db), 0);
  assert.deepEqual({ ...db.prepare('SELECT content,status,revision,approved_by,analysis_json,source_revision FROM drafts').get() }, {
    content: 'Reviewed response', status: 'approved', revision: 3, approved_by: 'owner', analysis_json: null, source_revision: null,
  });
  assert.deepEqual({ ...db.prepare('SELECT file_key,file_name,mime_type,metadata_json FROM evidence').get() }, {
    file_key: 'private/original.pdf', file_name: 'original.pdf', mime_type: 'application/pdf', metadata_json: null,
  });
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('source revisions ignore repeated syncs and approval transitions but track meaningful source changes', context => {
  const db = initialDatabase(context);
  db.exec(investigationMigration);
  addEvidence(db);
  assert.equal(revision(db), 1);
  db.exec(`UPDATE evidence SET content=content,title=title,metadata_json=metadata_json WHERE id='record';
    UPDATE cases SET amount=amount,currency=currency,due_at=due_at,updated_at='2026-11-08' WHERE id='case';
    UPDATE cases SET status='ready' WHERE id='case';`);
  assert.equal(revision(db), 1, 'Repeated Stripe syncs and review transitions must preserve source freshness.');
  db.exec("UPDATE evidence SET content='Customer acknowledged receiving the ticket' WHERE id='record'");
  assert.equal(revision(db), 2);
  db.exec("UPDATE cases SET title='Updated customer claim' WHERE id='case'");
  assert.equal(revision(db), 3);
  db.exec("UPDATE evidence SET metadata_json='{}' WHERE id='record'");
  assert.equal(revision(db), 4, 'New structured provenance is a meaningful source change.');
  db.exec("UPDATE evidence SET metadata_json='{}' WHERE id='record'");
  assert.equal(revision(db), 4, 'Identical structured provenance does not invalidate approval.');
  db.exec("UPDATE evidence SET file_key='private/replacement.pdf' WHERE id='record'");
  assert.equal(revision(db), 5);
  db.exec("DELETE FROM evidence WHERE id='record'");
  assert.equal(revision(db), 6);
});

test('moving an evidence record invalidates both its previous and destination case', context => {
  const db = initialDatabase(context);
  db.exec(investigationMigration);
  db.exec(`INSERT INTO cases(id,workspace_id,title,customer_name,amount,reason,due_at,source,created_at,updated_at)
    SELECT 'other-case',workspace_id,title,customer_name,amount,reason,due_at,source,created_at,updated_at FROM cases WHERE id='case';`);
  addEvidence(db);
  db.exec("UPDATE evidence SET case_id='other-case' WHERE id='record'");
  assert.equal(revision(db), 2);
  assert.equal(revision(db, 'other-case'), 1);
});

test('the database permits only one running or committing investigation per case and releases completed runs', context => {
  const db = initialDatabase(context);
  db.exec(investigationMigration);
  db.exec(`INSERT INTO cases(id,workspace_id,title,customer_name,amount,reason,due_at,source,created_at,updated_at)
    SELECT 'other-case',workspace_id,title,customer_name,amount,reason,due_at,source,created_at,updated_at FROM cases WHERE id='case';`);
  const insert = db.prepare(`INSERT INTO investigation_runs(id,workspace_id,case_id,status,mode,started_at,expires_at,source_revision,base_draft_revision,base_draft_status,base_draft_approved_at)
    VALUES(?,'ws',?,?,'sample','2026-11-07T12:00:00Z','2026-11-07T12:02:00Z',0,0,'none','')`);
  insert.run('first', 'case', 'running');
  assert.throws(() => insert.run('second', 'case', 'running'), /UNIQUE constraint/);
  db.exec("UPDATE investigation_runs SET status='committing' WHERE id='first'");
  assert.throws(() => insert.run('second', 'case', 'running'), /UNIQUE constraint/);
  insert.run('independent', 'other-case', 'running');
  db.exec("UPDATE investigation_runs SET status='completed' WHERE id='first'");
  insert.run('second', 'case', 'running');
  insert.run('historical', 'case', 'failed');
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM investigation_runs WHERE case_id='case'").get()!.total, 3);
});
