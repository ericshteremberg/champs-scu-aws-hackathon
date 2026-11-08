# Four-person build handoff

For the current cross-computer provider setup, use [Eric's OAuth registration handoff](05-eric-oauth-registration.md). It starts from the latest `codex/aiden-aws-harness`, separates developer registration from customer authorization, and returns configuration to Aiden for connector implementation. The role-branch baseline below is historical.

All four role branches start from the same planning commit on top of verified application commit `e78d7a1322fea09ed64ee2611c966ea9f662723f`. Each contains these handoffs so every teammate can see the boundaries and dependencies. The branches are independent places to work; this planning change does not update `main` or redeploy the app.

| Owner | Branch | Start here | Main responsibility |
| --- | --- | --- | --- |
| Aiden | `codex/aiden-aws-harness` | [AWS and harness](01-aiden-aws-harness.md) | Causality backend, investigation quality, integration and release |
| Eric | `codex/eric-frontend` | [Frontend](02-eric-frontend.md) | Organizer workflow, source inspection and review experience |
| Teammate 2 | `codex/atmsphr-evidence-api` | [Merchant evidence API](03-atmsphr-evidence-api.md) | Merchant-owned endpoint that serves only a permitted case |
| Teammate 3 | `codex/demo-evaluation` | [Evaluation and demo](04-evaluation-demo.md) | Evidence checks, presentation, recording and submission materials |

## Start on your own computer

Repository: <https://github.com/ericshteremberg/champs-scu-aws-hackathon>.

For a fresh checkout, replace `YOUR-BRANCH` with the exact branch from the table:

```sh
git clone https://github.com/ericshteremberg/champs-scu-aws-hackathon.git
cd champs-scu-aws-hackathon
git fetch origin
git switch --track origin/YOUR-BRANCH
npm ci
```

For an existing checkout, inspect `git status --short --branch` first and preserve any unfinished work. Fetch, then use `git switch YOUR-BRANCH` if the local branch exists, or `git switch --track origin/YOUR-BRANCH` if it does not. Do not discard another task's changes to switch branches.

Read your role file and [the application handoff](../HANDOFF.md). Each role file ends with a prompt you can give your coding agent. Node 22.13 or newer is required. Local browser tests use Chrome; CI uses Playwright Chromium.

## Shared starting point

- Causality's interface and review workflow are implemented. AWS Lambda, DynamoDB, S3 and Bedrock run the backend. Wrangler serves the frontend and authenticated bridge.
- The baseline passed 145 unit tests, 13 browser tests, both builds, direct AWS smoke checks and the complete published browser rehearsal. These are baseline results, not a substitute for checking new changes.
- Six bundled cases are fictional. Three are ticket cases: ATM-1042, ATM-1043 and ATM-1044. A real Bedrock call over them remains a synthetic-data demonstration.
- The live preview is <https://causality-hackathon-dev.slidah60.workers.dev>. Login is `dev`; the password must be shared privately. It is not in Git.
- Production ATMSPHR evidence is not connected. Automatic refunds, customer messaging and PDF/image text extraction are not implemented. Stripe submission is disabled by default.

## Working together

First, Eric gives teammate 2 the actual ATMSPHR backend location, permitted access and a corroborated sample order/dispute. Teammate 2 gives Aiden a synthetic contract fixture, then a working endpoint and approved case identifier. Aiden owns the client/worker connection. Eric can polish the existing synthetic workflow immediately. Teammate 3 can prepare evaluation cases and the presentation immediately, then replace placeholders with observed results.

The existing [evidence API contract](../EVIDENCE_API.md) is the shared boundary. Coordinate any wire-format change between Aiden and teammate 2 before implementing it. Aiden owns `lib/domain.ts`, shared investigation types, package changes and infrastructure; Eric owns interface components; teammate 2 owns new merchant-adapter files; teammate 3 owns evaluation and submission artifacts. Request a small coordinated change when work crosses those boundaries.

Push your role branch with a clear commit and report the SHA, checks run, known limitations and anything another role must do. Open a draft PR into `main` when useful. Aiden coordinates final integration and shared AWS/Worker deployments. Do not force-push, deploy the shared stack from competing branches, or merge someone else's unfinished branch.

Use normal merges to bring in necessary shared changes after preserving your working tree. Keep fixes in the owning branch. GitHub is the handoff between computers; finished work must be committed and pushed.

## Credentials, evidence and rehearsal

`.dev.vars`, `.dev-worker-access.txt`, `.aws-build/` and generated local state are ignored. Keep credentials, QR/redemption secrets and identifiable customer records out of commits, screenshots and public artifacts. Use fictional fixtures in Git; share approved anonymized examples through the agreed private channel.

Aiden owns workshop credential refresh and the shared preview login. `sync:dev-secrets` updates the deployed login and AWS bridge credentials; teammates should not rotate them independently. Both AWS Lambda functions need the same merchant connection and workspace binding. Local D1/R2 regression tools are compatibility tests, not the deployed database.

The deployed smoke commands make real AWS calls and change synthetic records. `test:dev:smoke` approves ATM-1042 and uploads a file to ATM-1044 in the shared demo workspace. Coordinate its timing before a recording. The earlier `docs/demo/` video depicts standalone Casework, so record the current Causality app for submission.

There is no project-root `context.md` at this checkpoint. Keep the existing architecture and handoff documents accurate; adding a new context document remains a separate decision.
