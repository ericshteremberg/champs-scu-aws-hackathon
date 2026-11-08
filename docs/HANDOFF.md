# Causality AWS handoff

The final product keeps Causality's interface and review workflow, with an AWS-native backend. Wrangler hosts the frontend and authenticated bridge. Private Lambda runs the API and background investigations, DynamoDB stores business records, S3 stores files and archives, and Bedrock Nova investigates case evidence.

The deployment has no Cloudflare database or R2 binding. The temporary development D1 database was deleted. D1/R2 source remains for original Sites compatibility and local regression tests only.

## Current state

- AWS stack: `causality-hackathon-dev`, region `us-east-1`; stack creation completed.
- Frontend: [causality-hackathon-dev.slidah60.workers.dev](https://causality-hackathon-dev.slidah60.workers.dev).
- Model: `us.amazon.nova-2-lite-v1:0`; a complete real investigation with validated citations was saved as a new draft requiring approval.
- Direct AWS acceptance passed: six DynamoDB samples and owner isolation, all three background ticket outcomes, private S3 uploads/downloads, cancellation, concurrent approval preservation, and approved archives.
- Published browser acceptance passed with `npm run test:dev:smoke`: authenticated frontend and signed Lambda bridge, real Bedrock investigation, approval/export, S3 archive, browser S3 upload, and private original download, with no JavaScript errors.
- Customer Stripe reads are connected and verified. Real Supabase rows and mailbox imports still need customer setup/testing. Refunds and outbound customer messaging remain disabled.
- Stripe and Supabase developer registration and customer authorization flows are implemented. Both have authorized customer connections in the shared workspace. A real Supabase project-list read passed; the customer still needs to select a project and approve its evidence columns. [OAuth connector status](OAUTH_CONNECTORS.md) describes the AWS secrets, state/token lifecycle, routes, checks and remaining work. [Selected dispute import, approved order mappings and reviewed linked-record imports](LINKED_EVIDENCE.md) are implemented. Real customer-row verification remains pending the in-app project/scope/mapping choices.

All six bundled cases are synthetic. The three ticket cases demonstrate receipt acknowledgement, delivery failures, and insufficient evidence. **Sample investigation** is deterministic. **AWS investigation** calls Bedrock. AWS failures remain errors and never silently become sample results.

## Linked-evidence release, November 8, 2026

The active implementation branch is `codex/aiden-aws-harness`. It incorporates `main` through `171d296`, including Eric's revised frontend and Resend connector. New work is the selected Stripe dispute import, explicit Supabase order/payment/email mapping, and reviewed case-bound record import described in [LINKED_EVIDENCE.md](LINKED_EVIDENCE.md). This feature branch must be fetched on the other computer; pushing it does not update `main`.

Live checks verified Stripe dispute and linked-charge reads, ten latest dispute summaries, and one full dispute/payment association without importing a real case. That sampled payment lacked a customer email. The optional approved order-email mapping fills an empty case address only after record review. Actual Supabase row queries remain untested because no project/scope/mapping has been selected. No database project, real dispute or mailbox was selected automatically.

Resend's existing developer secret and documented shared-workspace/domain binding were restored with the merged AWS template. Read verification passed for its two approved sending domains. The recreated receiver URL is recorded in [RESEND_CONNECTOR.md](RESEND_CONNECTOR.md); it returns 503 for unsigned input while the signing secret is absent. Webhook registration and real delivery-event capture are still pending. Do not deploy an older infrastructure template that omits these resources and parameters.

Release verification: `npm run check` passed (556 backend/adapter tests, TypeScript, frontend build and Lambda build). All 35 browser scenarios passed, with affected tests rerun after resolving upstream copy changes and adding the optional email mapping. Targeted ESLint and Wrangler dry runs passed. The final AWS deployment retained the Resend configuration and uploaded all three Lambda bundles. Frontend Worker version: `569fb256-cde1-4273-b26e-dabc4f2bf930`. Hosted checks passed for authentication, cross-origin and forged-input rejection, desktop/mobile evidence setup, and live Stripe reads. Logs and screenshots are in ignored `.aws-build/provider-evidence-*` and `.aws-build/linked-evidence-*` files. Architecture and handoff documents were updated in place; this repository has no root `context.md`.

## IMAP customer setup

Other email provider is available in Connections for Network Solutions and compatible password-based IMAP servers. The customer enters an email and selects Find email settings. AWS detects Network Solutions Cloud Mail or a public TLS SRV endpoint without a password. The customer then supplies the mailbox password and consent. Server and Sent-folder overrides are under Advanced settings; Sent is included automatically only when the server explicitly identifies one selectable folder. Unknown providers use manual settings, Google directs to Gmail OAuth, and Microsoft OAuth remains unavailable. No Google registration or custom endpoint is needed. Lambda verifies TLS and read-only folder access, then stores credentials in private encrypted-at-rest DynamoDB records. Search/preview/import is bound to an open case and requires review. Real provider login and mailbox reads remain untested. See [IMAP connector handoff](IMAP_CONNECTOR.md).

### Simplified mailbox setup verification

Password-free discovery and progressive setup are deployed to AWS and Worker version `c28e91bb-8dcf-4e37-b9f7-3d30eca39f7c`. The hosted flow detected Network Solutions for the customer's domain and passed desktop/mobile checks without a mailbox login or read. Existing customer connections were preserved. `npm run check` passed (576 backend/adapter tests, type checking and both builds), all 13 connector browser scenarios passed, and targeted ESLint plus Wrangler dry-run passed. The browser callback assertion was scoped to its message to avoid a concurrent evidence-loading status. See `scripts/smoke-imap.mjs` for repeatable hosted discovery and input-boundary checks. This repository has no root `context.md`; the existing architecture/handoff documents were updated instead.

## Customer lookup, automatic email discovery and Get evidence

`codex/aiden-aws-harness` is deployed with Worker version `757f88c0-26d2-47df-8bd6-e0874d5d2700` and the matching AWS backend. It now includes a unified **Get evidence** panel in Connections. It starts independent Stripe, Supabase, Resend and IMAP reads for one editable real case, shows each source's progress and result, and preserves successful reads if another provider fails. Results are previews; individual provider tools still handle reviewed evidence attachment. No automatic email, refund, Stripe response, or draft approval is performed. Missing/ambiguous customer emails remain a review step instead of guessed mailbox searches.

The new Supabase customer lookup can be configured in the IMAP card with one explicit approval of a table's ID, name and email columns. It returns separate candidate accounts, requires a selected server-held result before changing the case, and then searches IMAP using the saved address. Selecting the already-saved email preserves the case and draft; changing it clears prior approval. The live Broese lookup is configured for `orders.id`, `orders.name`, and `orders.email`. This does not configure full order/ticket evidence or create a trusted Stripe payment association for manually assembled cases.

IMAP now defaults in the UI to server-side address search across all selected folders. The newest-500 mode remains available, and existing response limits, read-only transport and deadlines remain enforced. Resend discovers explicit IDs already referenced by case evidence, including imported message-log fields, and automatically previews a single linked record. Its optional paginated sent-email metadata search returns only matching recipient/approved-domain summaries. Manual UUID entry remains an Advanced fallback.

Live verification found one matching Supabase customer record for the requested case, verified its Stripe dispute, and searched the correct email across INBOX and Sent without the 500-message restriction. IMAP returned no matches. The case-linked Resend ID was found automatically but its provider read returned 404; four pages (400 recent metadata records) had no recipient match and additional pages remained. The saved source date is August 21. Resend documents [30-day standard email/log retention](https://resend.com/security), which may explain the missing historical API record, but this was not independently confirmed as the cause. Existing manually captured evidence remains attached. No live case, report, evidence list or customer email was modified by verification.

Validation: full `npm run check`, targeted follow-up backend checks, targeted ESLint, Wrangler dry-run, 16 connector browser scenarios, and hosted desktop/mobile collection/customer-lookup checks passed. The hosted check reports provider data limitations separately from UI correctness. Repeat the non-importing browser check with `CAUSALITY_SMOKE_CASE_ID=<authorized-real-case> node scripts/smoke-customer-evidence.mjs`. Reports and screenshots are ignored under `.aws-build/customer-evidence-*`.

A concurrent remote branch, `codex/resend-history` at `5fffd36`, adds a complementary retained structured order-log fallback. Its retained-log helper and compiler context are now selectively adapted in the saved-evidence fix below; the rest of the branch remains unmerged. Further integration must preserve the new `find` action, metadata pagination, customer lookup and unified collector. Its structured-log path does not currently apply to manually captured unstructured evidence. Do not overwrite one implementation with the other during the handoff. This repository still has no root `context.md`; existing architecture and handoff documentation was updated in place.

## Unavailable historical Resend record: saved-evidence fallback

Deployed to the existing AWS backend and Worker version `52a0d66f-ea39-40e8-ba3f-79b424dc7f62`. The Resend card and Get evidence now display the original evidence already attached under an explicit matching Resend ID when the provider returns 404 or a temporary 502/503. The preview says **Saved case evidence, not reverified**, keeps source references and original text, and does not offer a duplicate Attach action. It does not claim a recovered provider body, new delivery verification or confirmed retention expiry. Case/evidence version guards preserve stale-read protection; a wrong live recipient/order remains an error. The same selected case keeps its existing evidence, report and approval unchanged.

Verification passed: `npm run check` (595 backend/adapter tests, type checking and both builds), all 17 connector browser scenarios, targeted ESLint and Wrangler dry-run. The hosted desktop/mobile smoke confirmed the requested case shows the saved Resend record with no error banner or duplicate Attach control; Get evidence labels it as saved rather than freshly verified. The case/report hash and evidence list remained unchanged. The smoke scrolls the IMAP field into view after mobile screenshots to avoid a browser actionability timeout. Live Resend retrieval still returns 404; the fallback uses only the existing attached source.

Eric's `aws/resend-history.ts` from `5fffd36` and its compiler context were adapted selectively. The broader `codex/resend-history` branch and later Stripe-write changes are not merged. Existing structured merchant email logs retain explicit limitations and failure counterevidence. Historical manual captures remain manual sources without invented provenance. See [RESEND_CONNECTOR.md](RESEND_CONNECTOR.md) for preview bounds, no-op import behavior and the repeatable hosted smoke command. The root `context.md` still does not exist, so these existing handoff and architecture docs were updated in place.

## Access and credential refresh

Use username `dev` and the password stored locally in ignored `.dev-worker-access.txt`. Share that file's value privately, outside Git. This is one shared team development workspace after authentication, not separate production accounts.

Copy the private access file securely when moving computers. `npm run init:dev-access` creates a new password only if the file is missing. Syncing that new password changes the login for everyone using the shared deployment.

The frontend bridge uses temporary Workshop Studio credentials to invoke the private Lambda. Refresh them when they expire:

```sh
node scripts/save-aws-session.mjs
npm run aws:check -- --invoke
npm run sync:dev-secrets
```

Run those commands from a terminal containing the current workshop credential exports. The helper preserves other `.dev.vars` settings and does not print secrets. The saved session overrides stale inherited AWS credentials; partial saved sessions fail explicitly. `sync:dev-secrets` reads `.dev.vars` and the existing private access file, then updates the Worker secret store. Editing `.dev.vars` or redeploying alone does not refresh hosted credentials.

Lambda accesses DynamoDB, S3, Bedrock, and its background worker using its execution role. Do not copy workshop credentials into Lambda environment variables. New merchant connections are managed in Connections and stored in the owning AWS workspace. Optional legacy merchant and Stripe environment credentials still require an exact workspace binding.

## Build and deploy

```sh
npm ci
npm run check
npm run deploy:aws
npm run deploy:dev
```

The AWS stack's S3 CORS origin must match `CAUSALITY_FRONTEND_ORIGIN`. The Wrangler configuration's `EVIDENCE_BUCKET_ORIGIN` must match the provisioned bucket. Keep `.aws-build/`, `.dev.vars`, preview passwords, and any generated secret-transfer files out of Git.

Run `npm run test:aws:smoke` after backend changes. It creates synthetic development records and files and makes real Bedrock requests; it is not a browser test.

Run `npm run test:dev:smoke` for the published browser rehearsal. It uses the private access file and changes only the shared synthetic demo cases, including approving ATM-1042 and attaching a test file to ATM-1044. Results are saved in ignored `.aws-build/browser-smoke.json`.

`deploy:aws` updates infrastructure and backend code. `deploy:dev` updates the separate Wrangler frontend. Neither command republishes the original Sites application. The README explains the retained local D1/R2 regression path.

## Keep frontend merges connected to AWS

Frontend changes must preserve same-origin `/api/` requests through `worker/index.ts` and `lib/server/aws-bridge.ts`. Deploy the preview with `wrangler.dev.jsonc`, which selects `DATA_BACKEND=aws`, the private Lambda and the S3 origin. A static frontend upload without that Worker does not provide the API connection. Keep AWS credentials server-side.

| Interface flow | Existing backend contract |
| --- | --- |
| Load and edit workspace | `GET /api/workspace` returns workspace state; `POST` sends a supported `action` and returns updated state |
| Investigate | `POST /api/investigations` with `action: start`, local `caseId` and `mode: bedrock` returns HTTP 202 and `{run}`; poll `GET ?caseId=...`, then reload workspace state |
| Cancel or import | Investigation actions are `cancel` with `runId`, or `import` with `externalCaseId`; import returns `{caseId,state}` |
| Manage a live evidence connection | `GET /api/connectors/live` returns `{connections,storage:'aws'}`. POST supports `connect` with `name`, `baseUrl`, `externalCaseId`, `token`; `recheck`, `disconnect`, and `import` use `connectionId` |
| Original files | Read `/api/runtime`; AWS uses prepare-upload, signed S3 form POST, then finalize-upload. Downloads go through the authenticated evidence route |
| Approve and archive | Approval includes the saved draft revision. `/api/investigations/archive` accepts `caseId` and that approved `revision` |

Run the local browser suite for interaction regressions and the published `npm run test:dev:smoke` for the actual AWS connection. The published check asserts AWS upload mode, a real Bedrock run, a persisted unapproved draft with saved source citations, approval/export/archive, and a uniquely identified new file upload/download. An AWS configuration flag alone does not prove that Lambda is reachable. A local sample or mocked test does not establish a live backend connection.

## Before the demo

1. Open the protected deployed frontend and verify its AWS runtime status.
2. Create the development workspace if needed and load the six sample cases.
3. Run a sample investigation and verify that progress survives a page reload.
4. Run an AWS investigation on ATM-1042. Inspect its trace, source citations, gaps, and saved draft.
5. Edit and approve the current revision, export it, and explicitly archive it to private S3.
6. Upload a small synthetic file through the signed S3 flow, then download the private original. Confirm that the new evidence clears approval.
7. Verify cancellation and a stale-result race before presenting them as working controls.
8. Record the final combined interface and keep credentials and private customer information off screen.

Use ATM-1044 to show that missing delivery history does not justify claiming receipt. Prepare ATM-1043 to show counterevidence supporting the customer's complaint.

## Connect the first ATMSPHR case

The Connections screen also supports a reusable guided setup. Its ATMSPHR and Rentul templates use explicitly fictional schemas to demonstrate the same query and evidence contract across two businesses. Reviewed mappings persist in DynamoDB under `evidence-connection#<id>` in the owner workspace. `GET /api/connectors` lists templates and configurations; POST actions are `preview`, `save`, `import_demo`, and `revoke`. `GET /api/connectors/install?connectionId=...` downloads public configuration files. No database credentials or case tokens enter these setup APIs.

The shared runtime and installer live in `integrations/evidence-connector/`; [CONNECTOR_SETUP.md](CONNECTOR_SETUP.md) explains deployment and permissions. Customers using this endpoint workflow configure the packaged service instead of implementing an endpoint. The separate [OAuth onboarding flow](OAUTH_CONNECTORS.md) supports provider authorization, public-schema review and explicit direct order/payment mappings; automatic semantic inference and automatic merchant-service hosting are not implemented. Template previews are not live connectivity tests, and revoking a saved setup is not revocation of an independently deployed service.

The live registry in `aws/managed-connectors.ts` supports in-app connect, recheck, import, and disconnect for a deployed public HTTPS evidence API. A connection requires one approved external case ID and its case-scoped token. Before saving, AWS checks the live summary and rejection of a random unrelated case through `aws/merchant-network.ts`. The rejection is an access-scope smoke check, not proof that the token cannot access other existing cases. Causality only requests the configured case; the merchant service must enforce its grant. The transport rejects private destinations and redirects and bounds response size and request duration. Recheck requires the merchant, order, and payment identity to remain the same. No Lambda environment changes are required for this flow. Legacy `MERCHANT_*` settings remain optional.

Public metadata uses `live-connection#<id>` in the owning workspace; credentials use separate private `connector-credential#<id>` items. DynamoDB table encryption protects storage at rest. The implementation does not use Secrets Manager or application-level encryption. Tokens never appear in returned metadata, workspace state, or audit details. Each connection covers one case, with up to 30 saved connections per workspace including disconnected entries. This uses the existing shared development login, not production multi-user authentication.

Disconnect atomically disables the connection and deletes its credential. Reads and result publication check connection ownership, status, and versions, so disconnection also blocks a concurrent publication. Existing imported evidence remains available. Revoke the merchant's source grant too to invalidate copies of the same token outside Causality.

Run `npm run install:connectors` after root `npm ci`. `npm run check` includes both merchant packages. `npm run test:connectors:aws` writes fictional configurations and cases to isolated AWS workspaces, verifies owner isolation and revocation, and runs real Bedrock investigations for both mappings. Browser onboarding tests use mocked connector responses against the local preview; those mocks do not establish a deployed AWS connection.

Published verification passed on November 7, 2026: both mappings completed real Bedrock runs with saved case-local citations; `npm run test:connectors:browser` exercised the protected dev frontend, actual AWS setup API, downloads and imports with no JavaScript errors. Its two clearly labeled connector samples remain in the shared dev workspace for rehearsal. Private operational results/screenshots stay under ignored `.aws-build/`. After rebuilding the local frontend, restart its preview process before browser tests so its asset manifest matches the rebuilt files.

The merchant evidence service is implemented locally with verified schema mappings and tests, but is not deployed or connected. See [the current implementation handoff and next steps](ATMSPHR_NEXT_STEPS.md).

Eric needs to deploy and verify the merchant-owned endpoint described in [EVIDENCE_API.md](EVIDENCE_API.md). Causality does not deploy it automatically or obtain database credentials.

Verify the actual organizer, Stripe account and mode, payment, order, and selected support thread. Do not join solely on an email address. In Connections, enter the deployed public HTTPS base URL, approved external case ID, and its token. After verification succeeds, import from the saved connection, inspect the summary mapping, then investigate and review the result. Keep the token and customer data off shared demo screens.

A merchant-imported case does not automatically become a Stripe-submittable case. Keep production account connections and submissions as separate decisions. Black Label Creators LLC is not connected by this handoff.

## Concurrency and evidence guarantees

Each entity is a DynamoDB item under the workspace partition. Version-conditional transactions protect case changes, draft changes, approvals, and active runs. Stripe submission is disabled in both backend implementations, regardless of the legacy environment flag. The case's source revision changes when evidence changes. Every investigation step verifies current run status and the captured source/draft state.

Starting a run returns immediately while a separate private investigator Lambda works. API and investigator concurrency are reserved separately, preserving capacity for status reads and cancellation. Run activity is stored separately from the draft, and the browser polls it. Cancellation prevents later steps and publication. A changed source record, edited or approved draft, closed case, or competing run blocks stale completion.

The investigator can select only the permitted evidence sections for its fixed case. It cannot choose another case, SQL, or arbitrary URLs. Citation validation checks source membership; human review still determines whether the evidence supports the claim.

The current limits are 90 evidence records per case, 300 KB per database item, 3 MB per transaction, 1 MB of model evidence context, and 10 MB per attachment. Broader data needs a narrower merchant response or a later pagination design.

## Division of work

The four role branches and detailed startup instructions are in [the team handoffs](handoffs/README.md). Each branch shares the verified application baseline and includes all four role documents.

| Owner | Next responsibility |
| --- | --- |
| Aiden | Connect the merchant client to AWS, improve claim-specific investigation quality, preserve safeguards, and coordinate integration/deployment |
| Eric | Polish the organizer review workflow and give the integration teammate the actual backend access and case context |
| Teammate 2 | Implement and verify the merchant-owned, case-scoped ATMSPHR evidence API |
| Teammate 3 | Evaluate sourced reports, prepare the pitch and recording, and assemble submission materials |

## Submission

Use [DEMO.md](DEMO.md) and verify the current [Devpost requirements](https://a10-x-aws-hack-26.devpost.com/). Add the repository and every teammate, and prepare a fresh video, screenshots, thumbnail, and any requested presentation material.

The older recording under `docs/demo/` documents standalone Casework, not this deployed Causality product. State precisely which parts of the final demo use real AWS calls and which source records are fictional. Do not claim recovered revenue or time savings without measurements.

GitHub is the cross-computer handoff. Share the actual pushed repository, branch, and commit from the final implementation report. The source checkpoint hashes in [BRANCH_COMPARISON.md](BRANCH_COMPARISON.md) are historical inputs, not the final merged revision.

Gmail now has an AWS OAuth lifecycle and reviewed case-email import UI. Its Google developer registration is complete and deployed in External / Testing mode. Real customer consent and mailbox reads remain untested; follow [the setup handoff](handoffs/06-gmail-oauth-registration.md). See [OAuth connector architecture](OAUTH_CONNECTORS.md#gmail-runtime-and-selected-evidence) for scope, temporary preview storage, token handling and untested live boundaries.


## Review-only evidence PDFs

The Report tab now leads with a dedicated evidence packet and **Download evidence PDF**. Drafts can be downloaded without approval, labeled Draft for review. Dirty edits, stale source revisions, running investigations and unresolved source references block PDF generation. Approval remains a separate merchant review action. Neither download nor approval submits anything.

The browser dynamically loads `lib/report/pdf.ts` and locally served Ubuntu fonts to generate a paginated PDF from the already authorized case snapshot. It contains the response, numbered source register, material review notes, and full saved source text. Original binary attachments are listed but not embedded. No provider requests or case writes occur during export. The existing approved JSON/S3 archive remains separate. See [EVIDENCE_PACKET.md](EVIDENCE_PACKET.md).

Attached documents can now route to multiple investigation topics. The engine permits identical attached/synthetic records across topics and counts them once; conflicting reuse and remote cross-section ID reuse still fail. Empty category diagnostics no longer become duplicate factual gaps. Existing reports expose those legacy diagnostics in a separate disclosure while retaining material qualifications in the PDF. Fresh investigations produce concise merchant responses with review notes in structured metadata.

Both AWS and legacy Stripe services return `submission_disabled` before constructing a Stripe client or changing storage, even if `STRIPE_ENABLE_SUBMISSION=true`. The submission modal and send action have been removed; the former submission tab is now Review package. Do not restore provider writes as part of frontend merging.
