import type { Evidence, Policy } from '../domain.ts';

export const POLICY_LIMITATIONS = [
  'An effective date entered by the merchant is a declaration, not independent historical proof.',
  'Possession of a policy does not prove that this customer saw or accepted it at checkout.',
  'A nonrefundable clause alone does not resolve a dispute or establish that the service was provided.',
];
export const policySignal = /\b(refund\w*|cancel\w*|terms|polic(?:y|ies)|consent|agree(?:d|ment)?|accept(?:ed|ance)?|checkout|disclos\w*|non.?refundable|all sales final)\b/i;
export function policyClauses(content: string): string[] {
  const parts = content.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map(p => p.trim()).filter(Boolean);
  return parts.filter(p => policySignal.test(p)).slice(0, 12).map(p => p.slice(0, 1800));
}
export function selectPolicies(policies: Policy[], purchaseAt?: string) {
  if (!purchaseAt || !Number.isFinite(Date.parse(purchaseAt))) return [];
  const day = purchaseAt.slice(0, 10);
  const eligible = policies.filter(p => Number.isFinite(Date.parse(p.effectiveDate)) && p.effectiveDate.slice(0, 10) <= day);
  const groups = new Map<string, Policy[]>();
  for (const p of eligible) { const key = p.familyId || `${p.kind || 'terms'}:${p.name.toLowerCase()}`; groups.set(key, [...(groups.get(key) || []), p]); }
  return [...groups.values()].flatMap(group => {
    const latest = group.map(p => p.effectiveDate.slice(0, 10)).sort().at(-1);
    return group.filter(p => p.effectiveDate.slice(0, 10) === latest && (!p.endsAt || p.endsAt > day)).map(policy => ({ policy, ambiguous: group.filter(p => p.effectiveDate.slice(0, 10) === latest).length > 1, capturedAfterPurchase: (policy.capturedAt || policy.createdAt) > purchaseAt }));
  });
}
export function policyRelatedRecords(records: Evidence[]) {
  return records.filter(r => r.source !== 'policy' && !(r.source === 'manual' && /^Analyst review/i.test(r.reference)) && policySignal.test(`${r.title}\n${r.content}`));
}
/** A shared customer email alone is not an exact-order correspondence link. */
export function exactOrderMention(text: string, orderRef: string): boolean {
  if (!orderRef || orderRef.length < 4) return false;
  const escaped = orderRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}($|[^a-zA-Z0-9_-])`, 'i').test(text);
}
