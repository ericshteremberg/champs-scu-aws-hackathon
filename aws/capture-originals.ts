import { captureOriginalEmails } from './original-evidence.ts';
import { captureOriginalStripeReceipt } from './stripe-originals.ts';
import { captureOriginalDatabaseRows } from './supabase-originals.ts';
import { ApiError, type TrustedUser } from './types.ts';

/** Each collector owns its source and connection checks; neither sends or submits anything. */
export async function captureOriginalEvidence(user: TrustedUser, caseId: string) {
  const result: { configured: boolean; captured: number; alreadySaved: number; remaining: number; unavailable: { provider: string; reason: string }[] } = { configured: false, captured: 0, alreadySaved: 0, remaining: 0, unavailable: [] };
  // Sequential because each successful collection advances the case revision.
  for (const [provider, collect] of [['Stripe', captureOriginalStripeReceipt], ['Supabase', captureOriginalDatabaseRows]] as const) {
    try {
      const source = await collect(user, caseId);
      result.configured ||= source.configured;
      result.captured += source.captured; result.alreadySaved += source.alreadySaved;
      result.unavailable.push(...source.unavailable);
    } catch (error) {
      if (error instanceof ApiError && ['conflict', 'run_active'].includes(error.code || '')) throw error;
      result.unavailable.push({ provider, reason: error instanceof ApiError ? error.message : 'The original source could not be collected. Existing evidence was preserved.' });
    }
  }
  // Database message-log rows can supply verified email links for the same collection pass.
  const email = await captureOriginalEmails(user, caseId);
  result.configured ||= email.configured; result.captured += email.captured; result.alreadySaved += email.alreadySaved; result.remaining = email.remaining;
  result.unavailable.push(...email.unavailable.map(value => ({ ...value, provider: 'Resend' })));
  return result;
}
