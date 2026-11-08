# Evaluation and local rehearsal

Latest implementation: [verified fact inventory, challenge-all preparation policy and CLI packets](../FACT_INVENTORY.md). [Six final live inventory evaluations](inventory-results.md) supersede the earlier prompt-only behavior below. The local runner now writes `inventory-runs/`; use `review-inventory-runs.mjs` for that batch. Historical `prompt-runs/` artifacts remain unchanged.

This directory owns evaluation tools, source review and demo rehearsal. The user subsequently authorized prompt fixes, regression tests and a real Bedrock rerun on this branch. Submission work remains deferred; the selected track is AWS.

[Contributor checkout and combined-branch verification](CONTRIBUTOR-HANDOFF.md) describes how to get the current branch, the merged mainline work and the remaining product limits.

See [the prompt-rerun results](prompt-results.md) for the latest application changes and remaining defects. The earlier [checkpoint note](RELEASE-NOTE.md) documents the pre-fix baseline. This branch is ready to share with its observed limitations, not as a guarantee of correct generation.

## Work completed on this branch

- Saved-run audit: `node docs/evaluation/audit-runs.mjs`. No credentials, server or network required. Regenerates [audit-summary.json](audit-summary.json) and [review-packet.md](review-packet.md). Checks case scope, synthetic provenance, completed Bedrock mode and citation membership. Label comparisons are against the proposed rubric, not a semantic accuracy score.
- [Reference responses](reference-responses.md): source-grounded editorial examples for the three fixtures, including corrected delivery wording, resend citation, local date, recommendations and response style. They are not rerun outputs or human sign-off.
- Local browser acceptance and [recorded sample rehearsal](artifacts/README.md): current Causality interface, isolated fictional cases, source inspection, saved edit, exact-revision approval and sample export.
- Live runner provenance: `run-evaluation.mjs` now records API **and investigator** Lambda metadata before and after each run, the full local commit, working application diff and source fingerprint. It stops after saving a result if the deployment changes. Configuration secrets are never persisted.

The evaluation scripts pass syntax and ESLint checks. The offline audit was exercised on the six saved baseline artifacts and on a deliberately broken citation, which correctly returned exit 1. The capture script was exercised against the local app. The Lambda-targeted `run-evaluation.mjs` provenance change has not been exercised against AWS. The separate local-engine runner made six real Bedrock investigations over the prompt revision; no deployment was required.

## Evaluate a local prompt change

```sh
node docs/evaluation/run-prompt-evaluation.mjs --repeats=2
node docs/evaluation/review-prompt-runs.mjs
```

The first command bundles the actual local engine and backend evidence adapter, uses the existing AWS session, and makes real paid Bedrock calls on fictional fixtures. It does not deploy, invoke Lambda or mutate shared workspaces. Source and input fingerprints, traces, output and token counts are saved in `prompt-runs/`. The second command rechecks those outputs offline. Its regression signals are not a semantic accuracy score or production validation gate. See [the observed results](prompt-results.md).

## Repeat the local rehearsal

From the project root, finish the build before starting the server. Rebuilding a running preview can leave its module map pointing at deleted assets.

```sh
npm run build
npm run db:migrate:local
npm start -- --port 8788
```

In another terminal:

```sh
npm run test:e2e
node docs/evaluation/capture-rehearsal.mjs
```

If the video encoder is missing, install it with `node node_modules/playwright/cli.js install ffmpeg`. To keep it temporary, prefix both install and capture commands with `PLAYWRIGHT_BROWSERS_PATH=/tmp/causality-playwright`.

Wrangler and Chrome require permission to bind/open local processes in a sandboxed agent environment. The loopback-only preview uses the retained Sites D1/R2 compatibility implementation. It neither needs the deployed development password nor verifies the AWS bridge, live Bedrock or S3 archival. Upload-related browser tests simulate AWS responses; report them as browser controls, not real S3 acceptance.

## Repeat live evaluation after an application fix

With valid AWS credentials and `.aws-build/deployment.json`, run:

```sh
node docs/evaluation/run-evaluation.mjs
node docs/evaluation/audit-runs.mjs
```

The first command makes real paid Bedrock calls and creates an isolated synthetic workspace. It does not approve, archive, submit or upload anything. Coordinate against shared deployments so the target build remains stable. Do not run it merely to increase the sample count while the application is unchanged.

Record a verified deployment-to-source mapping for both Lambda functions before calling a run a test of a particular fix. A local commit or source fingerprint alone proves no such mapping. Historical runs lack investigator metadata, and that information cannot be reconstructed from the API hash. Preserve them as historical observations.

Then read the packet against every original source, compare the complete report with the reference boundaries, and record the actual reviewer and corrections. Automated source-membership checks do not provide human sign-off. Human sign-off and measured preparation time remain honestly unrecorded; neither prevents completing local evaluation tooling and rehearsal.
