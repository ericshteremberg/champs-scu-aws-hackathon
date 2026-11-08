import { merchantCaseSchema, normalizeMerchantSection, type MerchantCase } from '../../lib/investigation/merchant.ts';

export const sections = ['summary', 'order', 'tickets', 'delivery', 'history', 'support', 'attendance', 'policy'] as const;
export type Section = typeof sections[number];
export interface Grant {
  caseId: string; merchantId: string; orderRef: string; paymentRef: string;
  stripeAccountId: string; livemode: boolean; expiresAt: string; revoked: boolean;
}
export interface VerifiedCase {
  metadata: MerchantCase;
  stripeAccountId: string; livemode: boolean;
  /** True only after corroborating organizer/account/mode/payment/order, never email alone. */
  mappingVerified: boolean;
  sections: Record<Section, unknown>;
}
export interface Repository {
  /** Resolve a SHA-256 digest, never store or log the bearer value. Fresh lookup on every request. */
  findGrant(digest: string, signal: AbortSignal): Promise<Grant | null>;
  /** Query with ALL grant predicates BEFORE fetching rows. No whole-database reads. */
  readCase(grant: Readonly<Grant>, signal: AbortSignal): Promise<VerifiedCase | null>;
}
class Failure extends Error { constructor(readonly status: number) { super('Evidence request denied'); } }
const validId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const validDate = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: {
  'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}),
} });

export function createEvidenceHandler(repository: Repository, now: () => Date = () => new Date()) {
  return async (request: Request): Promise<Response> => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    request.signal.addEventListener('abort', stop, { once: true });
    if (request.signal.aborted) stop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { stop(); reject(new Failure(504)); }, 14000);
    });
    const serve = async () => {
      if (controller.signal.aborted) throw new Failure(504);
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const url = new URL(request.url);
      const match = /^\/v1\/cases\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})\/evidence$/.exec(url.pathname);
      if (!match) throw new Failure(404);
      const bearer = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(request.headers.get('authorization') ?? '');
      if (!bearer) throw new Failure(401);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer[1]));
      const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      const found = await repository.findGrant(digest, controller.signal);
      if (!found) throw new Failure(401);
      const grant = structuredClone(found);
      if (grant.revoked || !validDate(grant.expiresAt) || Date.parse(grant.expiresAt) <= now().getTime()
        || !validId.test(grant.caseId) || grant.caseId !== match[1]
        || !grant.merchantId || !grant.orderRef || !grant.paymentRef || !grant.stripeAccountId
        || typeof grant.livemode !== 'boolean') throw new Failure(403);
      const section = url.searchParams.get('section') as Section;
      if (!sections.includes(section) || url.searchParams.getAll('section').length !== 1
        || [...url.searchParams.keys()].some(key => key !== 'section')) throw new Failure(400);
      const result = await repository.readCase(grant, controller.signal);
      if (controller.signal.aborted) throw new Failure(504);
      if (!result) throw new Failure(404);
      const m = merchantCaseSchema.parse(result.metadata);
      if (!result.mappingVerified || m.id !== grant.caseId || m.merchantId !== grant.merchantId
        || m.orderRef !== grant.orderRef || m.paymentRef !== grant.paymentRef
        || result.stripeAccountId !== grant.stripeAccountId || result.livemode !== grant.livemode) throw new Failure(403);
      const ids = new Set<string>(); let count = 0; let contextBytes = 0;
      let output: unknown;
      // Validate the whole bounded case, including global uniqueness, before serving ANY section.
      for (const name of sections) {
        const raw = result.sections[name];
        const normalized = normalizeMerchantSection(raw, grant.caseId, name);
        if (name === 'summary' && Object.keys(m).some(key => JSON.stringify(normalized.case?.[key as keyof MerchantCase]) !== JSON.stringify(m[key as keyof MerchantCase]))) throw new Failure(403);
        if (normalized.evidence.status === 'unavailable' && !normalized.evidence.limitations.length) throw new Failure(502);
        for (const record of normalized.evidence.records) {
          if (ids.has(record.id)) throw new Failure(502);
          ids.add(record.id); count++;
          if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 280 * 1024) throw new Failure(502);
        }
        if (name === section) {
          const e = normalized.evidence;
          output = { case_id: e.caseId, section: e.section, source_mode: e.sourceMode,
            fetched_at: e.fetchedAt, status: e.status, limitations: e.limitations,
            records: e.records.map(r => ({ evidence_id: r.id, source: r.source, source_id: r.sourceId,
              occurred_at: r.occurredAt, data: { title: r.title, detail: r.detail, fields: r.fields } })),
            ...(name === 'summary' ? { mapping_verified: true, case: normalized.case } : {}),
          };
        }
        contextBytes += new TextEncoder().encode(JSON.stringify(normalized.evidence)).byteLength;
        if (count > 90 || contextBytes > 1024 * 1024 || new TextEncoder().encode(JSON.stringify(raw)).byteLength > 1024 * 1024) throw new Failure(502);
      }
      // Recheck expiry/revocation after the bounded read as well as at entry.
      const current = await repository.findGrant(digest, controller.signal);
      if (!current || JSON.stringify(current) !== JSON.stringify(grant) || Date.parse(grant.expiresAt) <= now().getTime()) throw new Failure(403);
      if (controller.signal.aborted) throw new Failure(504);
      return json(output);
    };
    try { return await Promise.race([serve(), timedOut]); }
    catch (error) { return json({ error: 'evidence_unavailable' }, error instanceof Failure ? error.status : 502); }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', stop); }
  };
}
