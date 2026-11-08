# Aiden: AWS backend and investigation harness

Branch: `codex/aiden-aws-harness`. Start with [team setup and coordination](README.md).

## Outcome

Take one approved, anonymized ATMSPHR dispute through the existing scoped API client, AWS investigation, sourced report and human review. Make the investigator useful for the specific customer claim while preserving its permission and revision boundaries. Own integration of the four role branches and the shared deployment.

## What already works

The private Lambda API and a separate investigator Lambda use DynamoDB for state and S3 for originals/archives. The default model is `us.amazon.nova-2-lite-v1:0` in `us-east-1`. The published browser flow has passed with synthetic records, including approval, export and private S3 upload/download.

The harness retrieves authorized sections, validates source envelopes, gives the model short citation aliases, and restores canonical record IDs in saved reports. It rejects invented citations and gives corrective feedback for invalid report fields. It limits runs to two minutes, 12 model calls, 16 tool attempts and 1 MB of normalized evidence. Cancellation and source/draft revision checks prevent stale publication. These controls already exist; extend them only for a demonstrated gap.

## Owned files

- `aws/`: Lambda routing, jobs, persistence, files and connector orchestration.
- `lib/investigation/`: client normalization, bounded tool loop, report validation and types.
- `lib/domain.ts`, `worker/index.ts`, `lib/server/aws-bridge.ts` and authentication boundaries when integration requires a change.
- `infra/aws-backend.json`, AWS/deployment scripts and shared package configuration.
- Backend tests: `tests/investigation.test.ts`, `tests/investigation-aws.test.ts`, `tests/aws-*.test.ts` and relevant operational smoke scripts.

Eric owns interface files and the browser suite. Teammate 2 owns the merchant-side adapter and its fixtures. Teammate 3 owns evaluation results and submission materials. Keep the original Sites compatibility path working, but do not use its D1/R2 storage for the AWS deployment.

## First work session

1. Read `aws/investigations.ts`, `lib/investigation/merchant.ts`, `lib/investigation/engine.ts` and [the evidence contract](../EVIDENCE_API.md). Confirm the consumer accepts teammate 2's synthetic summary and section fixtures before any live connection.
2. Define the initial case with Eric: the exact nonreceipt claim, merchant/account/mode, payment-to-order relationship and approved support thread. Obtain the real endpoint location and private credential from teammate 2 without putting either private evidence or secrets in Git.
3. Configure `MERCHANT_EVIDENCE_URL`, `MERCHANT_EVIDENCE_TOKEN` and `MERCHANT_WORKSPACE_ID` on both `causality-hackathon-backend` and `causality-hackathon-investigator`. Preserve all existing Lambda environment variables. Check that subsequent infrastructure updates preserve the connection too; the current template does not manage these optional values.
4. Import through `POST /api/investigations` with `{ "action": "import", "externalCaseId": "..." }`. Start with the returned local case ID and `mode: "bedrock"`. Import creates a case; it does not grant access to a new merchant or enable Stripe submission.
5. Review the full report against original records with teammate 3. For a ticket-not-received claim, treat ticket access/receipt and event attendance as separate questions. Missing attendance alone should not erase verified receipt evidence. Never turn provider acceptance into proof of inbox delivery or reading. Fix specific observed reasoning failures with focused regression cases before considering model tuning.
6. Confirm cancellation, changed-source protection and draft approval still work with imported evidence. Produce one reviewed report with visible citations and remaining gaps, then give Eric the exact UI state and any actionable API errors.

## Checks and release

Use `npm run test:investigation` for backend regressions, `npm run typecheck`, and `npm run build:aws`. Run `npm run check` for an integration candidate. It covers both builds and the unit suites without requiring a live AWS session.

For the shared deployment, use the existing credential/deployment instructions in [HANDOFF.md](../HANDOFF.md). After relevant backend changes, run `npm run test:aws:smoke`; after integrating the interface, run `npm run test:dev:smoke`. Both create synthetic records and make real AWS calls. Coordinate with teammate 3's recording window. Rehearse the approved anonymized case separately without submitting a real dispute.

## Deliverable

Push a checked backend commit with the case integration results, exact model/region, test outcomes and remaining limitations. The case must keep its merchant/payment/order binding, expose only authorized sources, produce a reviewable draft and preserve later reviewer edits. Do not expand this sprint into refunds, live Stripe submission, Gmail OAuth or a new authentication system.

After teammates push their work, integrate reviewed commits and rerun checks appropriate to the combined changes. Report the final GitHub SHA and deployed version so the recording matches the code.

## Agent startup prompt

> Work on `codex/aiden-aws-harness`. Read `docs/handoffs/README.md` and `docs/handoffs/01-aiden-aws-harness.md`, then inspect the current branch, working tree and fetched remote state. Own the Causality AWS backend and bounded investigator. First validate the merchant contract with teammate 2's synthetic fixtures, then connect an approved anonymized case once the actual endpoint and private access exist. Preserve scope, citation, cancellation and revision checks. Keep Eric's interface and the merchant-owned adapter outside your edits unless coordinated. Run appropriate checks, update relevant existing docs, commit and push this branch, and report the SHA and remaining dependencies. Do not invent access or expose secrets/customer records.
