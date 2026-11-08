# Teammate 2: ATMSPHR evidence API

Branch: `codex/atmsphr-evidence-api`

Starting application revision: `e78d7a1322fea09ed64ee2611c966ea9f662723f`

Deliver a merchant-owned endpoint returning evidence for one authorized ticket dispute. Causality's AWS backend and merchant API client exist; ATMSPHR's endpoint and production connection remain unimplemented.

Read [team coordination](README.md), [the API contract](../EVIDENCE_API.md), `lib/investigation/merchant.ts`, and the import/summary checks in `aws/investigations.ts` before implementing anything. The schemas in the code determine what the running consumer accepts.

## Ownership and dependencies

Own new adapter code, fictional contract fixtures, tests, and setup documentation under `integrations/atmsphr/`. Use Eric's actual merchant repository for database queries and deployment once he provides access and identifies its runtime. This repository lacks ATMSPHR's schema and backend. Do not invent tables or duplicate customer records.

Eric supplies the source repository, one approved dispute, its account routing, and the relationships between payment, order, tickets, delivery attempts, and selected correspondence. Aiden owns `lib/investigation/`, `aws/`, infrastructure, and the Lambda connection. Agree on contract changes with him before editing shared files. Eric owns the frontend; teammate 3 owns evaluation and submission assets.

Keep tokens, customer records, database credentials, and private environment files out of Git. Commit fictional fixtures with the same shape, plus a private-data handling/setup explanation that contains no values.

## First milestones

1. **Map one real case with Eric.** Record which existing identifiers corroborate the organizer, Stripe account and mode, payment, order, and tickets. Match support correspondence using an order reference or corroborating facts. Email alone is insufficient. Confirm available delivery events and distinguish provider acceptance, delivery, and reading. Mark absent sources honestly.
2. **Agree on the grant and fixture.** Build one fictional summary envelope and one example for each section, including unavailable sections. Validate them through `normalizeMerchantSection`. Define a server-side credential bound to the approved merchant/case grant, with expiry and revocation checked on every request.
3. **Implement bounded reads in the merchant backend.** Constrain queries by the verified merchant and order before selecting records. Select permitted fields; exclude ticket redemption secrets, unrelated history, and database internals. Returning selected rows after fetching the entire database does not satisfy the intended boundary.
4. **Test denial and missing-data paths.** Establish that a changed case identifier cannot retrieve a different customer's records, then exercise the acceptance checks below.
5. **Connect with Aiden.** Provide the HTTPS base URL, approved external case ID, safe field-mapping notes, and test results. Transfer the bearer credential privately. Aiden configures both the API Lambda and separate investigator Lambda with the same workspace-bound connection, preserving their existing environment settings. Import and investigate one anonymized real case together.

## Contract to implement

Serve `GET /v1/cases/{externalCaseId}/evidence?section={section}` with bearer authentication. Allowed sections are `summary`, `order`, `tickets`, `delivery`, `history`, `support`, `attendance`, and `policy`.

Every JSON response needs `case_id`, `section`, `source_mode`, `fetched_at`, `status`, `records`, and `limitations`. Each record needs `evidence_id`, `source`, `source_id`, `occurred_at`, and `data` containing `title`, `detail`, and scalar-valued `fields`. Use stable, case-specific evidence IDs, unique across sections.

Summary additionally requires `mapping_verified: true` and camelCase `case` metadata: `id`, `merchantId`, `merchantName`, `customerLabel`, `claim`, `reason`, `amount`, `currency`, `eventName`, `purchasedAt`, `openedAt`, `dueAt`, `sourceMode`, `summary`, `orderRef`, and `paymentRef`; `tags` defaults to an empty array. Include one summary record with both `fields.orderRef` and `fields.paymentRef` matching that metadata. Do not attest a mapping you cannot verify. Amounts use currency minor units; timestamps include a timezone offset.

The current wire schema accepts only `source_mode: "live"` and `case.sourceMode: "live"`. Redacting identifiers from genuinely retrieved records must preserve their relationships and provenance. A recorded snapshot must not be presented as live; coordinate any snapshot-mode support with Aiden.

For missing sources, return `status: "unavailable"`, empty `records`, and explicit limitations. Use `partial` when returning a bounded subset. There is no client pagination. Respect the 15-second request timeout, 1 MB response/context bounds, and 90-record total case limit. Full field limits are in the contract and validator.

**Identifier compatibility:** the internal import helper permits dots/colons, but the HTTP entry-point validator and merchant fetcher reject them. Use an alphanumeric first character followed by letters, digits, underscores, or hyphens, at most 160 characters. This satisfies all three checks. Report any desired expansion to Aiden instead of weakening one side independently.

## Checks and completion

Run the existing consumer checks with `npm run test:investigation`. Add a dedicated runnable test command/config under `integrations/atmsphr/`; the root Vitest include pattern does not discover arbitrary tests there automatically.

Cover valid and invalid credentials, expired/revoked grants, another case or merchant, unsupported sections, changed payment/order mappings, summary without corroborating identifiers, mismatched case/section envelopes, duplicate IDs, malformed dates, oversized responses, redirects, and unavailable evidence. Expected HTTP outcomes are 401 for invalid credentials, 403 for denied grants, 404 for unavailable approved cases, and 400 for invalid sections.

Finish with a deployed merchant endpoint, documented field mapping, reproducible tests, fictional fixtures, and one imported case whose saved evidence links back to its source records. Provide Aiden the pushed merchant-repository commit as well as this branch's commit. This work does not enable Stripe submissions, refunds, or customer messaging.

## Agent startup prompt

> Work on `codex/atmsphr-evidence-api`. Read `docs/handoffs/README.md` and this handoff. Inspect branch, working tree, and fetched upstream before edits. Implement the scoped merchant adapter using Eric's actual backend and schema; start with fictional contract fixtures if access is unavailable. Keep shared client/engine changes with Aiden, and never commit private records or credentials. Run the adapter and existing contract tests, document the endpoint and integration results, then commit and push task-related work to this branch. Report the repository, commit, checks, and any remaining access dependency.
