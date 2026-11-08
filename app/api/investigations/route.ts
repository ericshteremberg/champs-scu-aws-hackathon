import { z } from 'zod';
import { InvestigationError } from '@/lib/investigation/types';
import { requireApiUser, requireWorkspace, assertSameOrigin, errorResponse, readLimitedBody, ApiError } from '@/lib/server/auth';
import { getWorkspaceState } from '@/lib/server/workspace';
import { cancelInvestigation, getInvestigationConfig, getLatestInvestigation, importMerchantCase, startInvestigation } from '@/lib/server/investigations';
export const dynamic = 'force-dynamic';
const id = z.string().min(1).max(180);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), caseId: id, mode: z.enum(['sample', 'bedrock']) }).strict(),
  z.object({ action: z.literal('cancel'), runId: id }).strict(),
  z.object({ action: z.literal('import'), externalCaseId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/) }).strict(),
]);
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireApiUser(); const workspace = await requireWorkspace(user.userId);
    const caseId = new URL(request.url).searchParams.get('caseId');
    if (caseId) return Response.json({ run: await getLatestInvestigation(workspace.id, caseId) }, { headers });
    return Response.json({ config: getInvestigationConfig(workspace.id) }, { headers });
  } catch (error) { return errorResponse(error instanceof InvestigationError ? new ApiError(502, error.message, error.code) : error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const user = await requireApiUser();
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096))); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'Send a valid JSON request.'); }
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, 'Choose a valid investigation action and case.');
    const action = parsed.data;
    if (action.action === 'cancel') return Response.json({ run: await cancelInvestigation(user, action.runId) }, { headers });
    if (action.action === 'import') return Response.json({ caseId: await importMerchantCase(user, action.externalCaseId, AbortSignal.any([request.signal, AbortSignal.timeout(20000)])), state: await getWorkspaceState(user) }, { headers });
    const run = await startInvestigation(user, action.caseId, action.mode, request.signal);
    return Response.json({ run, state: await getWorkspaceState(user) }, { headers });
  } catch (error) { return errorResponse(error instanceof InvestigationError ? new ApiError(502, error.message, error.code) : error); }
}
