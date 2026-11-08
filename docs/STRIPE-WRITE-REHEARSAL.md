# Stripe draft writes and submission rehearsal

Causality supports two separate server actions:

- `POST /api/stripe/draft` saves approved text with `submit=false`.
- `POST /api/stripe/submit` submits approved text with `submit=true`.

A saved Stripe draft can still be submitted by Stripe's deadline auto-response settings. The draft UI displays the exact report revision and requires acknowledgment of this behavior. Both actions require an approved, current report on a Stripe-bound case. Neither action sends email.

## Deployment configuration

The existing operator restricted-key integration handles writes. The read-only customer OAuth app does not gain write permission from this change.

Configure the backend through the team's secret/configuration process:

- `STRIPE_RESTRICTED_KEY`: a restricted key for the intended account/environment, with dispute write and the read permissions needed to verify the account and retrieve disputes. Keep it server-side.
- `STRIPE_WORKSPACE_ID`: the workspace allowed to use that key.
- `STRIPE_ENABLE_DRAFT_WRITES=true`: enables only draft saves. Unset/false by default.
- `STRIPE_ENABLE_SUBMISSION=true`: separately enables immediate final submission. Leave false for draft-only operation.
- `STRIPE_ALLOW_LIVE=true`: additional live-account opt-in; keep false for sandbox tests.

Connect/verify that operator account using the existing Stripe integration, then sync its disputes. A manually created case or a case imported through a different connector is not silently rebound to this account. New permissions, deployment, or live writes are not performed by the rehearsal.

## Write protections

The backend checks workspace/account binding, report approval and revision, source freshness, confirmation, case status, attachments, and Stripe response eligibility. It claims the case atomically before calling Stripe, so concurrent actions cannot both write. Draft and final requests have different idempotency keys.

Draft saves refuse to replace different existing response text. Successful draft saves must return the exact text, the same dispute and environment, an open response status, and an unchanged submission count. The case then returns to ready. An uncertain outcome stays locked for reconciliation. This is text-only; supporting attachments must be handled separately.

Stripe does not offer a conditional evidence update: an external Dashboard edit between the preflight read and write can still race with this action. Avoid editing the same dispute in parallel.

## Local proof with the real Stripe SDK

Run:

```sh
npx vitest run --config vitest.config.ts tests/aws-stripe.test.ts
```

Optionally provide absolute local paths via `STRIPE_REHEARSAL_REPORT` and `STRIPE_REHEARSAL_PROOF` to test a particular report and save a redacted JSON proof. Do not commit customer report files.

The rehearsal uses the production service and installed Stripe SDK, a synthetic restricted key, an in-memory store, and an intercept-only HTTP transport. It has no network fallback and never reads real Stripe credentials. It verifies draft and final form bodies, exact report preservation, separate idempotency keys, and a single final write under concurrent attempts. The proof contains a report hash rather than customer text.

This proves local request construction and state transitions. It does not prove Stripe will accept the configured account's permissions, report, or dispute. That requires a separate Stripe sandbox test. No live dispute must be used for the rehearsal.

API reference: https://docs.stripe.com/api/disputes/update
