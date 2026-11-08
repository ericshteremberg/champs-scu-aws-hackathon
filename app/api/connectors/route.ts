import { requireApiUser, assertSameOrigin, errorResponse } from '@/lib/server/auth';
export const dynamic = 'force-dynamic';

// The deployed Worker routes this path to the private AWS Lambda before reaching
// this fallback. Connector configuration is never persisted in Cloudflare D1.
function unavailable() {
  return Response.json({ error: 'Connector setup requires the AWS-backed development deployment.', code: 'aws_required' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
export async function GET() {
  try { await requireApiUser(); return unavailable(); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); await requireApiUser(); return unavailable(); } catch (error) { return errorResponse(error); }
}
