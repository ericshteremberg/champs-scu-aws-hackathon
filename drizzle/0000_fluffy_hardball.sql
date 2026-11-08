CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text,
	`scope` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text NOT NULL,
	`reviewed_by` text,
	`created_at` text NOT NULL,
	`reviewed_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`case_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_workspace` ON `audit_logs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`customer_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`status` text DEFAULT 'needs_review' NOT NULL,
	`reason` text NOT NULL,
	`order_ref` text DEFAULT '' NOT NULL,
	`due_at` text NOT NULL,
	`source` text NOT NULL,
	`stripe_dispute_id` text,
	`stripe_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cases_workspace` ON `cases` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cases_stripe_unique` ON `cases` (`workspace_id`,`stripe_dispute_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`case_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`generated_at` text NOT NULL,
	`approved_at` text,
	`approved_by` text,
	`method` text DEFAULT 'evidence_template' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`file_key` text,
	`file_name` text,
	`mime_type` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_case` ON `evidence` (`workspace_id`,`case_id`);--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`effective_date` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stripe_connections` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`account_name` text NOT NULL,
	`mode` text NOT NULL,
	`connected` integer DEFAULT true NOT NULL,
	`last_sync_at` text,
	`next_cursor` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`onboarding_complete` integer DEFAULT false NOT NULL,
	`retention_days` integer DEFAULT 90 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_owner` ON `workspaces` (`owner_id`);