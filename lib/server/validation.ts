import { z } from 'zod';
const date=z.string().max(40).refine(v=>!Number.isNaN(Date.parse(v)),'Enter a valid date.');
const id=z.string().min(1).max(180);
const source=z.enum(['stripe','gmail','imap','database','policy','manual']);
const website=z.string().max(500).optional().default('').refine(v=>!v||/^https?:\/\//i.test(v),'Use a full http or https URL.');
export const actionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('createWorkspace'),name:z.string().trim().min(2).max(100),industry:z.string().max(100).optional().default(''),website}),
 z.object({action:z.literal('seedDemo')}),
 z.object({action:z.literal('addCase'),title:z.string().trim().min(3).max(160),customerName:z.string().trim().min(1).max(120),email:z.union([z.string().email(),z.literal('')]).optional().default(''),amount:z.number().int().min(1).max(999999999),currency:z.string().regex(/^[a-zA-Z]{3}$/).refine(v=>Intl.supportedValuesOf('currency').includes(v.toUpperCase()),'Choose a recognized currency.').transform(s=>s.toLowerCase()).optional().default('usd'),reason:z.string().min(1).max(4000),orderRef:z.string().max(100).optional().default(''),dueAt:date}),
 z.object({action:z.literal('updateCase'),caseId:id,status:z.enum(['needs_review','investigating','ready']).optional(),title:z.string().trim().min(3).max(160).optional()}),
 z.object({action:z.literal('addEvidence'),caseId:id,source,title:z.string().trim().min(2).max(160),content:z.string().trim().min(1).max(24000),occurredAt:date,reference:z.string().max(300).optional().default('')}),
 z.object({action:z.literal('generateDraft'),caseId:id}),
 z.object({action:z.literal('saveDraft'),caseId:id,content:z.string().trim().min(30).max(50000),revision:z.number().int().min(0)}),
 z.object({action:z.literal('approveDraft'),caseId:id,revision:z.number().int().min(1)}),
 z.object({action:z.literal('requestAccess'),caseId:id.optional(),scope:z.string().trim().min(3).max(500),reason:z.string().trim().min(10).max(2000)}),
 z.object({action:z.literal('resolveAccess'),requestId:id,decision:z.enum(['approved','denied'])}),
 z.object({action:z.literal('saveSettings'),name:z.string().trim().min(2).max(100),industry:z.string().max(100).optional().default(''),website,retentionDays:z.number().int().min(7).max(365)}),
 z.object({action:z.literal('addPolicy'),name:z.string().trim().min(2).max(160),content:z.string().trim().min(10).max(24000),effectiveDate:date}),
 z.object({action:z.literal('removePolicy'),policyId:id}),
]);
export function canReviewAccess(requestedBy: string, reviewerId: string) { return requestedBy !== reviewerId; }
