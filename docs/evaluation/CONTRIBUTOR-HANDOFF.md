# Contributor checkout: codex/demo-evaluation

This development checkpoint adds a [code-controlled fact inventory and offline CLI packets](../FACT_INVENTORY.md). It includes `origin/main` through `9e8e473` and Aiden's `codex/aiden-aws-harness` through `44ec7e9`, including guided connector setup and workspace-managed case-scoped connections. It does not update the shared deployment or merge this branch into `main`.

For a fresh checkout:

```sh
git clone --branch codex/demo-evaluation https://github.com/ericshteremberg/champs-scu-aws-hackathon.git
cd champs-scu-aws-hackathon
npm ci
npm run install:connectors
npm run check
```

For an existing clean checkout, fetch, switch to `codex/demo-evaluation` (or create it tracking `origin/codex/demo-evaluation`), then `git pull --ff-only`. Preserve other work before switching. CI uses Node 24.

The merchant adapter is a standalone package. Its own CI job installs and checks its pinned dependencies; root TypeScript checks exclude that package rather than requiring its database test dependencies in the web app:

```sh
npm ci --prefix integrations/atmsphr
npm run typecheck --prefix integrations/atmsphr
npm test --prefix integrations/atmsphr
```

The root lock retains the optional WASI repair and the frontend dependencies merged from main. Use `npm ci` with the committed lock; do not regenerate it with an unrelated install.

## What to review

- `lib/investigation/facts.ts`, `engine.ts` and `prompt.ts`: code-owned source reads, fact wording, citations, evidence assessment and packet eligibility; model output is an ID-only layout.
- `tests/investigation-facts.test.ts`, `investigation-packet.test.ts` and the engine tests: positive and adversarial cases, source-order checks, queue/provider distinctions, field-based claims, citation ownership, original image bytes and packet boundaries.
- [Six final real Bedrock runs](inventory-results.md): responses reproduced exactly by code, with no extra model prose. Only ATM-1042 has selected affirmative support under V1; ATM-1043/1044 receive explicit incomplete review packets.
- [Aiden's requested reasoning review](../handoffs/05-fact-inventory-review.md): source trust, completeness, selection policy, rule coverage, chronology, and whether model-based presentation is useful. No sign-off is implied.
- [Fictional CLI packet](packet-example/README.txt): selected source text and labeled transcript renders; internal review is separate from the outgoing response. Run `npm run packet:export -- --demo ATM-1042 --output /tmp/NEW_DIRECTORY` to reproduce it.
- [Rehearsal assets](artifacts/README.md): baseline local deterministic sample capture, clearly labeled with its earlier build. It is not footage of the new live prompt runs.

## Final combined-branch verification

- The merged branch passed type checking, 56 Node tests, 291 investigation/AWS/connector unit tests, frontend build and Lambda build. The final three integration regressions were added after the full check and verified with another type check and unit suite run.
- Both standalone connector packages passed type checking: 90 ATMSPHR tests and 22 generic connector tests. Install their pinned dependencies with `npm run install:connectors` before checking a fresh checkout.
- All 21 Chrome browser tests passed, covering the 13 demo-evaluation flows plus guided ticket/rental setup and managed connection import, secret clearing, disconnect, endpoint validation and mobile layouts.
- Both CI API suites passed: workspace/file isolation and investigation scope/cancellation/races. The first workspace API attempt was interrupted by a preview-worker restart; a full rerun passed without changing application code.
- The merge preserves the fact-only report engine. Harness mocks now return fact-ID plans, and regression tests reject extra model prose, verify eight-section retrieval, and exercise both connector templates through the inventory. Existing disconnect/publication race and credential isolation checks remain active.
- Local migrations are current. The six saved live model runs still reproduce exactly in the offline inventory audit. Those runs predate this harness merge; the AWS worker has changed, so their full source fingerprint is historical. No new live merchant or paid model evaluation ran for this merge.

## Remaining product limits

The model can no longer author outgoing claims or citations. That does not establish that upstream fields or the code's rules are correct. The real ATMSPHR adapter currently lacks some affirmative fields used in the fictional fixtures; other reason codes, original-file interpretation, free-text contradictions, source authenticity and chronology still require expert review. Challenge-all is a preparation policy, not proof of a win. Human-edited prose loses the code-generated label. Human source-level sign-off remains unrecorded.

No production merchant connection, Stripe submission, deployment, refunds or customer messaging were enabled. No operator time-saving or real-case accuracy claim is supported. Submission-package work remains deferred. The unrelated `.kiro/` directory stays local and untracked.
