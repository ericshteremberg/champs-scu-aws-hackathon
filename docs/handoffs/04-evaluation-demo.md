# Teammate 3: evaluation, demo, and submission

Branch: `codex/demo-evaluation`

Verified application baseline: `e78d7a1322fea09ed64ee2611c966ea9f662723f`

Your job is to prove what Causality does and turn that proof into a clear presentation. Start with the [team coordination guide](README.md), [current demo](../DEMO.md), [business validation plan](../BUSINESS.md), and [ticket fixtures](../../lib/ticket-demo.ts).

## Starting point

The published Causality workflow has passed a real Bedrock investigation, human approval, export, private S3 archival, and browser upload/download. The baseline has 145 passing unit tests and 13 browser tests. These checks establish working software, not accurate conclusions on every case or business savings. All six bundled cases are fictional. Production ATMSPHR evidence and Stripe submission are disconnected.

The [development frontend](https://causality-hackathon-dev.slidah60.workers.dev) requires the privately shared development login. It is one shared workspace. The old video in `docs/demo/` shows standalone Casework and must not be presented as the current application.

## First tasks, in order

1. Read the three ticket fixtures and write the expected evidence facts before reading model output.
2. Create `docs/evaluation/results.md` with a case-by-case review table. Start untested rows as **not run**. For each actual run, record the application commit, date, model/mode, input provenance, run identifier, observed findings, incorrect or missing claims, correction effort, reviewer, and outcome.
3. Coordinate one evaluation session with Aiden. Review the original source behind every material finding and the draft response. A valid citation proves source membership; it does not prove that the source supports the sentence.
4. Send reproducible reasoning failures to Aiden and interaction problems to Eric. Include the case, expected behavior, observed behavior, and relevant source IDs. Rerun affected cases after a fix, then rehearse the final release once.
5. Prepare the pitch, current screenshots, fresh backup video, and submission text under `docs/submission/`. Adapt the existing three-minute script to the actual organizer limit after verifying it.

## Evaluation matrix

| Case | Facts the response should preserve | Failure to flag |
| --- | --- | --- |
| ATM-1042 | Captured payment, two issued tickets, accepted email, delivered SMS, completed recovery, and a matched customer message acknowledging both tickets. | Claiming that provider acceptance proves receipt, or overlooking the direct acknowledgement. Missing attendance must not erase evidence of ticket access. |
| ATM-1043 | Payment and issuance coexist with bounced email attempts, undelivered SMS, and a pre-event support complaint. | Omitting counterevidence, treating a requested resend as successful delivery, or asserting that every possible delivery route failed. |
| ATM-1044 | Payment and issuance exist; delivery, recovery, and matched support records are unavailable. | Claiming receipt or failed delivery from absent history, or treating ticket creation as delivery. |

Evaluate claims and citations rather than demanding an identical assessment label from every model run. Attendance is distinct from receiving tickets. None of these fixtures establishes attendance, cardholder identity, or a bank decision. When Eric and the API teammate provide a verified anonymized case, add it separately with its provenance and approved scope. Do not relabel fictional records as customer evidence.

## Presentation and submission package

Create `docs/submission/pitch.md`, `docs/submission/checklist.md`, and a recording manifest identifying the final build, inputs, inference mode, and recording date. Keep the business explanation grounded in Eric's actual workflow: locating linked evidence, inspecting it, and preparing a response for review.

Explain the architecture accurately: Cloudflare serves the frontend and authenticated bridge; a private Lambda handles the API; a separate Lambda investigates; Bedrock Nova selects evidence tools and drafts findings; DynamoDB stores cases and revisions; S3 stores private attachments and archives. The merchant-owned API supplies approved case records.

Verify the current deadline, presentation/video limits, required fields, teammate registration, and submission instructions using the [organizer site](https://aws.scuacm.com/) and [Devpost listing](https://a10-x-aws-hack-26.devpost.com/). Record links and the check date. These requirements have not been verified by this handoff.

Label live inference, recordings, deterministic samples, and synthetic inputs clearly. Present preparation-time savings only when measured, including review and corrections. Do not claim increased win rates, recovered revenue, automatic refunds, lawsuit prevention, or exclusive market novelty.

## Ownership and checks

Own `docs/evaluation/`, `docs/submission/`, `docs/DEMO.md`, and `docs/BUSINESS.md`. Coordinate new presentation/video assets with the team; preserve historical recordings. Leave application code, fixtures, AWS configuration, and the merchant contract to their owners.

For documentation changes, check links, factual consistency, and `git diff --check`. Aiden coordinates `npm run test:aws:smoke` and `npm run test:dev:smoke`: they invoke paid AWS services and change synthetic records. The public browser smoke approves ATM-1042 and adds an attachment to ATM-1044, so schedule it outside a recording session. Never include passwords, tokens, or raw customer exports in Git or footage.

Done means three reviewed evaluation cases, disclosed unresolved limitations, a rehearsed presentation with a current backup recording, and a submission-ready package handed to Aiden. Commit and push this branch with the observed results and final artifact locations.

## Prompt for your agent

> Work on `codex/demo-evaluation`. Read `docs/handoffs/README.md` and `docs/handoffs/04-evaluation-demo.md`. Build the evaluation truth table and submission package from actual sources and observed runs. Preserve synthetic/live provenance, report unsupported claims, and coordinate shared AWS runs with Aiden. Own evaluation and presentation documentation only. Verify current organizer requirements before stating them. Commit and push your work to this branch; report the commit, checks, artifacts, and unresolved limitations.
