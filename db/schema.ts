import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', {
 id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), name: text('name').notNull(), industry: text('industry').notNull().default(''), website: text('website').notNull().default(''), onboardingComplete: integer('onboarding_complete', {mode:'boolean'}).notNull().default(false), retentionDays: integer('retention_days').notNull().default(90), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
}, t=>[uniqueIndex('workspaces_owner').on(t.ownerId)]);
export const cases = sqliteTable('cases', {
 id:text('id').primaryKey(), workspaceId:text('workspace_id').notNull().references(()=>workspaces.id), title:text('title').notNull(), customerName:text('customer_name').notNull(), email:text('email').notNull().default(''), amount:integer('amount').notNull(), currency:text('currency').notNull().default('usd'), status:text('status').notNull().default('needs_review'), reason:text('reason').notNull(), orderRef:text('order_ref').notNull().default(''), dueAt:text('due_at').notNull(), source:text('source').notNull(), stripeDisputeId:text('stripe_dispute_id'), stripeAccountId:text('stripe_account_id'), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[index('cases_workspace').on(t.workspaceId),uniqueIndex('cases_stripe_unique').on(t.workspaceId,t.stripeDisputeId)]);
export const evidence = sqliteTable('evidence', {
 id:text('id').primaryKey(), workspaceId:text('workspace_id').notNull().references(()=>workspaces.id), caseId:text('case_id').notNull().references(()=>cases.id), source:text('source').notNull(), title:text('title').notNull(), content:text('content').notNull().default(''), occurredAt:text('occurred_at').notNull(), reference:text('reference').notNull().default(''), fileKey:text('file_key'), fileName:text('file_name'), mimeType:text('mime_type'), createdAt:text('created_at').notNull(),
},t=>[index('evidence_case').on(t.workspaceId,t.caseId)]);
export const drafts = sqliteTable('drafts', {
 caseId:text('case_id').primaryKey().references(()=>cases.id), workspaceId:text('workspace_id').notNull().references(()=>workspaces.id), content:text('content').notNull(), status:text('status').notNull().default('draft'), generatedAt:text('generated_at').notNull(), approvedAt:text('approved_at'), approvedBy:text('approved_by'), method:text('method').notNull().default('evidence_template'), revision:integer('revision').notNull().default(1),
});
export const policies = sqliteTable('policies', {id:text('id').primaryKey(),workspaceId:text('workspace_id').notNull().references(()=>workspaces.id),name:text('name').notNull(),content:text('content').notNull(),effectiveDate:text('effective_date').notNull(),createdAt:text('created_at').notNull()});
export const accessRequests = sqliteTable('access_requests', {id:text('id').primaryKey(),workspaceId:text('workspace_id').notNull().references(()=>workspaces.id),caseId:text('case_id'),scope:text('scope').notNull(),reason:text('reason').notNull(),status:text('status').notNull().default('pending'),requestedBy:text('requested_by').notNull(),reviewedBy:text('reviewed_by'),createdAt:text('created_at').notNull(),reviewedAt:text('reviewed_at')});
export const auditLogs = sqliteTable('audit_logs', {id:text('id').primaryKey(),workspaceId:text('workspace_id').notNull().references(()=>workspaces.id),actor:text('actor').notNull(),action:text('action').notNull(),detail:text('detail').notNull(),caseId:text('case_id'),createdAt:text('created_at').notNull()},t=>[index('audit_workspace').on(t.workspaceId)]);

export const stripeConnections = sqliteTable('stripe_connections', {
 workspaceId:text('workspace_id').primaryKey().references(()=>workspaces.id), accountId:text('account_id').notNull(), accountName:text('account_name').notNull(), mode:text('mode').notNull(), connected:integer('connected',{mode:'boolean'}).notNull().default(true), lastSyncAt:text('last_sync_at'), nextCursor:text('next_cursor'), createdAt:text('created_at').notNull(),
});
export const stripeEvents = sqliteTable('stripe_events', {
 id:text('id').primaryKey(), workspaceId:text('workspace_id').notNull().references(()=>workspaces.id), accountId:text('account_id').notNull(), eventType:text('event_type').notNull(), processedAt:text('processed_at').notNull(),
});
