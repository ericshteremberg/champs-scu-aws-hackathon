ALTER TABLE cases ADD COLUMN data_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE cases ADD COLUMN merchant_case_id text;
--> statement-breakpoint
ALTER TABLE cases ADD COLUMN merchant_id text;
--> statement-breakpoint
ALTER TABLE cases ADD COLUMN payment_ref text;
--> statement-breakpoint
CREATE UNIQUE INDEX cases_merchant_unique ON cases(workspace_id, merchant_case_id);
--> statement-breakpoint
ALTER TABLE evidence ADD COLUMN metadata_json text;
--> statement-breakpoint
ALTER TABLE drafts ADD COLUMN analysis_json text;
--> statement-breakpoint
ALTER TABLE drafts ADD COLUMN source_revision integer;
--> statement-breakpoint
CREATE TABLE investigation_runs (
 id text PRIMARY KEY NOT NULL,
 workspace_id text NOT NULL REFERENCES workspaces(id),
 case_id text NOT NULL REFERENCES cases(id),
 status text NOT NULL,
 mode text NOT NULL,
 model_id text,
 started_at text NOT NULL,
 expires_at text NOT NULL,
 finished_at text,
 source_revision integer NOT NULL,
 base_draft_revision integer NOT NULL,
 base_draft_status text NOT NULL,
 base_draft_approved_at text NOT NULL,
 events_json text NOT NULL DEFAULT '[]',
 error text
);
--> statement-breakpoint
CREATE INDEX investigation_runs_case ON investigation_runs(workspace_id, case_id, started_at);
--> statement-breakpoint
CREATE UNIQUE INDEX investigation_runs_active ON investigation_runs(workspace_id, case_id) WHERE status IN ('running', 'committing');
--> statement-breakpoint
CREATE TRIGGER evidence_revision_insert AFTER INSERT ON evidence BEGIN
 UPDATE cases SET data_revision = data_revision + 1 WHERE id = NEW.case_id AND workspace_id = NEW.workspace_id;
END;
--> statement-breakpoint
CREATE TRIGGER evidence_revision_update AFTER UPDATE ON evidence
WHEN OLD.source IS NOT NEW.source OR OLD.title IS NOT NEW.title OR OLD.content IS NOT NEW.content
 OR OLD.occurred_at IS NOT NEW.occurred_at OR OLD.reference IS NOT NEW.reference
 OR OLD.file_key IS NOT NEW.file_key OR OLD.file_name IS NOT NEW.file_name OR OLD.mime_type IS NOT NEW.mime_type
 OR OLD.metadata_json IS NOT NEW.metadata_json OR OLD.case_id IS NOT NEW.case_id OR OLD.workspace_id IS NOT NEW.workspace_id
BEGIN
 UPDATE cases SET data_revision = data_revision + 1 WHERE (id = NEW.case_id AND workspace_id = NEW.workspace_id) OR (id = OLD.case_id AND workspace_id = OLD.workspace_id);
END;
--> statement-breakpoint
CREATE TRIGGER evidence_revision_delete AFTER DELETE ON evidence BEGIN
 UPDATE cases SET data_revision = data_revision + 1 WHERE id = OLD.case_id AND workspace_id = OLD.workspace_id;
END;
--> statement-breakpoint
CREATE TRIGGER case_metadata_revision AFTER UPDATE OF title, customer_name, email, amount, currency, reason, order_ref, due_at, source, merchant_case_id, merchant_id, payment_ref ON cases
WHEN OLD.title IS NOT NEW.title OR OLD.customer_name IS NOT NEW.customer_name OR OLD.email IS NOT NEW.email
 OR OLD.amount IS NOT NEW.amount OR OLD.currency IS NOT NEW.currency OR OLD.reason IS NOT NEW.reason
 OR OLD.order_ref IS NOT NEW.order_ref OR OLD.due_at IS NOT NEW.due_at OR OLD.source IS NOT NEW.source
 OR OLD.merchant_case_id IS NOT NEW.merchant_case_id OR OLD.merchant_id IS NOT NEW.merchant_id OR OLD.payment_ref IS NOT NEW.payment_ref
BEGIN
 UPDATE cases SET data_revision = data_revision + 1 WHERE id = NEW.id;
END;
