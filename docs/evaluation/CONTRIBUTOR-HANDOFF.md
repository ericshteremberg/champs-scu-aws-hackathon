# Contributor checkout: codex/demo-evaluation

This is a verified development checkpoint with prompt improvements and disclosed generation defects. It includes `origin/main` through `a5c8b6a` (merchant evidence adapter and frontend refinements). It does not update the shared deployment or merge this branch into `main`.

For a fresh checkout:

```sh
git clone --branch codex/demo-evaluation https://github.com/ericshteremberg/champs-scu-aws-hackathon.git
cd champs-scu-aws-hackathon
npm ci
npm run check
```

For an existing clean checkout, fetch, switch to `codex/demo-evaluation` (or create it tracking `origin/codex/demo-evaluation`), then `git pull --ff-only`. Preserve other work before switching. CI uses Node 24.

The merchant adapter is a standalone package. Its own CI job installs and checks its pinned dependencies; root TypeScript checks exclude that package rather than requiring its database test dependencies in the web app:

```sh
npm ci --prefix integrations/atmsphr
npm run typecheck --prefix integrations/atmsphr
npm test --prefix integrations/atmsphr
```

The root lock contains the same two missing optional WASI entries repaired on the AWS branch; no application dependency versions changed. `npm ci --dry-run --ignore-scripts` accepts the lock.

## What to review

- `lib/investigation/prompt.ts` and the `finish_report` descriptions in `engine.ts`: explicit labels, delivery/access/attendance boundaries, source support, evidence-only next steps, response voice and event time zones.
- `tests/investigation-regressions.test.ts`: positive and negative checks against observed bad outputs, including swapped citations and negated delivery statements. These test an offline fixture rubric, not guaranteed model behavior or a production semantic gate.
- [Six real Bedrock reruns](prompt-results.md): all six expected labels, no repeated invented nonattendance or refund/outcome advice, with source fingerprints and remaining issues. The local engine was tested directly without changing the shared AWS app.
- [Rehearsal assets](artifacts/README.md): baseline local deterministic sample capture, clearly labeled with its earlier build. It is not footage of the new live prompt runs.

## Final combined-branch verification

- `npm run check`: 56 Node tests, 100 investigation/AWS unit tests, frontend build and Lambda build passed.
- Adapter typecheck and all 90 tests passed. The local HTTP test requires loopback access; the first sandboxed attempt failed only because binding was denied.
- All 13 Chrome browser tests passed in 22.9 seconds after merging `main`.
- Both CI API suites passed: workspace/file isolation and investigation scope/cancellation/races. The first workspace API attempt was interrupted by a preview-worker restart; a full rerun passed without changing application code.
- Local migrations are current. The engine/source files used for live inference retain their recorded fingerprints after the merge.

## Remaining product limits

The revised prompt improves the evaluated examples but does not eliminate unsupported claims. ATM-1044's second rerun uses an order-only citation for an issuance sentence, and limitations remain repetitive. Absence wording and evidence-review focus still need care. Event dates were omitted in the new live outputs, so the timezone instruction was not live-exercised. Human source-level sign-off remains unrecorded.

No production merchant connection, Stripe submission, deployment, refunds or customer messaging were enabled. No operator time-saving or real-case accuracy claim is supported. Submission-package work remains deferred. The unrelated `.kiro/` directory stays local and untracked.
