# Causality AWS handoff

The final product keeps Causality's interface and review workflow, with an AWS-native backend. Wrangler hosts the frontend and authenticated bridge. Private Lambda runs the API and background investigations, DynamoDB stores business records, S3 stores files and archives, and Bedrock Nova investigates case evidence.

The deployment has no Cloudflare database or R2 binding. The temporary development D1 database was deleted. D1/R2 source remains for original Sites compatibility and local regression tests only.

## Current state

- AWS stack: `causality-hackathon-dev`, region `us-east-1`; stack creation completed.
- Frontend: [causality-hackathon-dev.slidah60.workers.dev](https://causality-hackathon-dev.slidah60.workers.dev).
- Model: `us.amazon.nova-2-lite-v1:0`; a complete real investigation with validated citations was saved as a new draft requiring approval.
- Direct AWS acceptance passed: six DynamoDB samples and owner isolation, all three background ticket outcomes, private S3 uploads/downloads, cancellation, concurrent approval preservation, and approved archives.
- Published browser acceptance passed with `npm run test:dev:smoke`: authenticated frontend and signed Lambda bridge, real Bedrock investigation, approval/export, S3 archive, browser S3 upload, and private original download, with no JavaScript errors.
- Real ATMSPHR evidence, production Stripe, refund actions, and customer messaging are not connected.

All six bundled cases are synthetic. The three ticket cases demonstrate receipt acknowledgement, delivery failures, and insufficient evidence. **Sample investigation** is deterministic. **AWS investigation** calls Bedrock. AWS failures remain errors and never silently become sample results.

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

Lambda accesses DynamoDB, S3, Bedrock, and its background worker using its execution role. Do not copy workshop credentials into Lambda environment variables. Optional merchant and Stripe credentials belong on Lambda, with an exact workspace binding.

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

The merchant evidence service is implemented locally with verified schema mappings and tests, but is not deployed or connected. See [the current implementation handoff and next steps](ATMSPHR_NEXT_STEPS.md).

Eric needs to deploy and verify the merchant-owned endpoint described in [EVIDENCE_API.md](EVIDENCE_API.md). Causality does not deploy it automatically or obtain database credentials.

Verify the actual organizer, Stripe account and mode, payment, order, and selected support thread. Do not join solely on an email address. Configure `MERCHANT_EVIDENCE_URL`, `MERCHANT_EVIDENCE_TOKEN`, and `MERCHANT_WORKSPACE_ID` on Lambda. Import the approved external case ID, inspect the verified summary mapping, then investigate and review the result.

A merchant-imported case does not automatically become a Stripe-submittable case. Keep production account connections and submissions as separate decisions. Black Label Creators LLC is not connected by this handoff.

## Concurrency and evidence guarantees

Each entity is a DynamoDB item under the workspace partition. Version-conditional transactions protect case changes, draft changes, approvals, active runs, and Stripe submission claims. The case's source revision changes when evidence changes. Every investigation step verifies current run status and the captured source/draft state.

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
