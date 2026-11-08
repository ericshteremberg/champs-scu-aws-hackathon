# Eric: frontend and merchant workflow

Branch: `codex/eric-frontend`

Verified application baseline: `e78d7a1322fea09ed64ee2611c966ea9f662723f`

Read [team coordination](README.md), [current deployment handoff](../HANDOFF.md), and [merchant API contract](../EVIDENCE_API.md) first.

## Outcome

Make the organizer's workflow easy to demonstrate: open a dispute, investigate, inspect original sources, edit a response, approve its saved revision, export, and archive. Use your experience with ATMSPHR disputes to identify the steps that actually save preparation work.

The interface already implements this workflow. Improve its clarity and verify its behavior while preserving the working application.

## Starting state

Causality has a landing page, onboarding, case queue, evidence library, connections, review screens, and a 53-screen design catalog at `/design/screens`. Six fictional cases include ticket examples ATM-1042, ATM-1043, and ATM-1044.

The published development application has passed a real Bedrock investigation, approval/export, private S3 archive, browser upload, and private download. AWS owns the backend and storage. Wrangler serves the frontend and authenticated bridge. Production ATMSPHR evidence and Stripe submission are still disconnected.

Merchant import already exists under Connections. It accepts an approved external case ID and becomes available when the backend reports a configured merchant connection. Sample investigation is deterministic; AWS investigation calls Bedrock. Keep these labels distinct.

## First tasks

1. Walk through ATM-1042 as an organizer. Write down the three most confusing moments before editing components. Inspect a citation and its original record, edit and save the draft, approve, and export.
2. Give the evidence API teammate the relevant ATMSPHR repository access and explain one payment-to-order-to-ticket relationship. Identify the organizer/account, live or test mode, delivery provider, and one corroborated support thread. Transfer access privately. Customer records and credentials do not belong in this repository.
3. Improve the existing investigation and report experience where the walkthrough revealed friction. Prioritize readable source references, clear progress and cancellation, visible counterevidence and gaps, understandable errors, and saved-versus-unsaved approval state.
4. Rehearse merchant import once Aiden connects the endpoint. Handle denied access, unavailable evidence, and changed mappings with useful messages. A configured connection is not proof that a request succeeded.
5. Work with the evaluation/demo teammate on the presentation sequence. Supply the organizer's explanation of the problem and the exact screens to show. Use synthetic cases until an anonymized real case is ready.

## Ownership

Primary files:

- `components/workspace/workspace-app.tsx`: API wiring, import, investigation, evidence, and review flow.
- `components/workspace/workspace-extra.tsx`: report preview, setup, settings, and supporting screens.
- `components/workspace/workspace.css`: workspace styling.
- `lib/design/fixtures.ts`, `lib/design/screens.ts`, and `app/design/screens/page.tsx`: isolated design previews.
- `tests/investigation-ui.spec.ts`: browser regression coverage for workflow changes.

Coordinate landing-page edits with the demo teammate's messaging. Coordinate shared types in `lib/domain.ts` with Aiden. Aiden owns `aws/`, `lib/investigation/`, authentication, infrastructure, deployment scripts, and the AWS bridge. The evidence API teammate owns the merchant endpoint and its contract implementation.

Keep the scope on dispute preparation. Preserve the existing identity path, approval protections, sample labels, and disabled production actions. Shared deployment and credential changes go through Aiden's integration work.

## Checks

Use Node 22.13 or newer. From your branch:

```sh
npm ci
npm run check
npm run db:migrate:local
npm start -- --port 8788
```

With that local server running, use another terminal:

```sh
CAUSALITY_UI_TEST_BASEURL=http://127.0.0.1:8788 npm run test:e2e
```

The browser runner uses installed Chrome locally. If Chrome is unavailable, install Playwright Chromium with `npx playwright install chromium`, then prefix the test command with `CI=1`.

This local test path uses retained D1/R2 emulation and synthetic identities. It does not verify the deployed AWS database. Never point these tests at a public URL. Aiden runs the separate published `npm run test:dev:smoke` after integration; it uses real AWS calls and changes shared synthetic demo records.

## Finish line and handoff

An organizer can complete the review workflow without operating instructions. A citation opens its source. Counterevidence and missing records remain visible. Unsaved edits cannot be exported as approved; changed evidence clears prior approval. Loading, failure, cancellation, and missing-case states remain usable. The design catalog remains isolated from live workspace data.

Push your branch with screenshots, a short list of changes, commands and results, and any remaining issue. Give Aiden the pushed commit SHA. Give the demo teammate a reproducible screen sequence. Keep original customer records, passwords, and generated build output out of Git.

## Agent startup prompt

```text
Work on codex/eric-frontend in ericshteremberg/champs-scu-aws-hackathon.
Read docs/handoffs/README.md and docs/handoffs/02-eric-frontend.md.
Inspect branch, working tree, upstream, and fetched remote state first.
Improve the existing Causality merchant workflow within this handoff's scope.
Preserve AWS-backed behavior, source citations, sample labeling, approval
protections, and isolated design previews. Coordinate shared API/type changes
with Aiden. Run relevant checks, commit task-related files, push this branch,
and report the pushed SHA and any remaining blockers. Do not deploy or merge
main as part of this frontend assignment.
```
