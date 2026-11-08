# ATMSPHR evidence API: implementation handoff

Implementation commit: `ecceb04` on `codex/atmsphr-evidence-api`.

The merchant evidence service is implemented under [`integrations/atmsphr/`](../integrations/atmsphr/README.md). It is not deployed, production is not connected, and no Supabase data, schema, permissions, or credentials were changed. Merging the source does not complete the production connection.

## Delivered and checked

- GET endpoint for the existing eight-section contract, with case-bound bearer grants, expiry/revocation checks, and sanitized errors.
- Parameterized reads using the inspected Supabase schema, restricted to the approved organizer/order/payment before rows are retrieved.
- Live Stripe dispute/charge reads to corroborate the payment, processing account, mode, and amount.
- Bounded source records with stable IDs, provenance, and explicit limitations for unavailable sources.
- Fictional fixtures, private grant-file support, HTTP server, and an unapplied column-scoped database-role proposal.
- Passed: 90 adapter tests (including embedded PostgreSQL isolation/privilege checks and an actual HTTP consumer request), 89 existing investigation tests, adapter/root type checks, and adapter lint.

## Next steps, in order

| Owner | Action | Completion evidence |
| --- | --- | --- |
| Eric / merchant operator | Choose merchant-controlled hosting or integrate the service into the actual merchant backend. Review [`server.ts`](../integrations/atmsphr/server.ts) and the setup instructions. | HTTPS endpoint serving the exact route; production logs exclude credentials and customer records. |
| Eric / merchant database administrator | Provision a restricted, TLS-verified database connection. Review [`read-role.sql`](../integrations/atmsphr/read-role.sql) and applicable RLS policies before applying any access changes. | Required queries work with the restricted login; writes and unapproved columns are denied. The proposed role does not itself create case-level RLS. |
| Eric / merchant operator | Supply a restricted Stripe read key for the correct platform/account and live/test mode through private server configuration. | The approved dispute's charge resolves to the approved PaymentIntent and order total in the expected account. A host payout destination alone is insufficient. |
| Eric / merchant operator | Approve one native paid Stripe ticket dispute and create its private case grant, including order UUID/number, organizer UUID, payment/dispute/account IDs, mode, expiry, pseudonymous customer label, and claim. | Correct case succeeds; another case, expired grant, and revoked grant are denied on the deployed service. Share the bearer privately, never in Git or chat. |
| Aiden | Connect the deployed merchant service to Causality using the existing connection setup and exact workspace binding. | Approved case imports, investigation completes, and saved evidence citations resolve to source records. Preserve existing runtime settings. |
| Eric + Aiden + evaluation owner | Review one approved anonymized real case and capture permitted demonstration material. | Record the observed endpoint/import results, source gaps, and approved screenshots without private records or credentials. |

Use the [existing evidence contract](EVIDENCE_API.md) and [service README](../integrations/atmsphr/README.md) for the exact settings and grant shape. Do not paste private configuration values into this document.

## Scope that remains deliberately unavailable

- Support correspondence until one thread is corroborated to the order. Organizer messages have no order foreign key.
- SMS provider events until their order linkage is verified; phone/profile matching alone is insufficient.
- Immutable historical policy text and proof of its presentation. The service reports the stored terms version and age acknowledgement as partial evidence.
- Imported `broese` cases, membership redemptions/bundles, external door payments, guest-list admissions, and payments without issued orders. These require separate adapters; they are not silently treated as native ticket orders.

Provider acceptance does not prove inbox delivery or reading. Missing scans do not prove nonattendance. Database refund history does not independently prove settlement.

## Repository setup follow-up

The root lock file currently prevents `npm ci`: it lacks `@emnapi/core@1.10.0` and `@emnapi/runtime@1.10.0` entries. This was observed during implementation and was not changed in this branch. The checks above passed after installing the root dependencies without updating the lock. Aiden should repair and verify the root clean-install path separately. The adapter has its own pinned package lock and test command.

No submission, refund, customer-messaging, shared deployment, or production access changes are part of this merge.
