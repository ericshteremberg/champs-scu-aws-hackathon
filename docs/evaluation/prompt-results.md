# Prompt revision: live Bedrock rerun

Evaluated November 7, 2026 Pacific. Mode: **live Bedrock**, model `us.amazon.nova-2-lite-v1:0`, region `us-east-1`. All inputs are the three fictional ticket fixtures. Six investigations completed: two per case.

## Result

All six assessments match the defined rubric: ATM-1042 supported, ATM-1043 mixed, ATM-1044 insufficient. The prior channel-delivery overstatement, invented nonattendance, resend-request citation error, outcome/refund advice and third-person recap opening were not observed in these reruns. All 50 response citation occurrences resolve to retrieved records in their case.

This is an improvement on these examples, not a guarantee of correct reports. One new issuance sentence still cites an order record that does not itself establish issuance. Repetitive limitations and overbroad absence wording also remain. Event dates were omitted, so the local-date instruction was **not exercised live** and cannot be called fixed on the basis of these runs.

## What changed

[The system prompt](../../lib/investigation/prompt.ts) now defines the three labels, preserves the customer's actual claim, separates provider statuses from receipt/access/attendance, requires the retry outcome for retry-failure claims, restricts recommendations to evidence review, specifies event time zones, and requests a merchant response rather than a recap. The `finish_report` tool descriptions reinforce the same field meanings. The engine's scope, cancellation, citation and revision controls remain intact; no production semantic validator was added.

The unit regression suite tests the known bad outputs, corrected examples, citation swaps, date labels and negative wording such as “cannot confirm delivery.” A separate engine test verifies that both retrieval and finish requests carry the response contract. These tests verify the instructions and evaluation checks; they cannot prove a model will obey the prompt.

## Build and execution provenance

The runner bundled the changed local engine with the existing backend `localEvidence` adapter and sent its actual Converse requests to Bedrock. It did not deploy, invoke Lambda, persist DynamoDB records, approve, archive, upload or submit anything. Cancellation and persistence races are not exercised by this local runner.

- Batch: `ca6a0990-a1e3-4e1a-8aeb-13a7973ba0a5`.
- Source parent commit: `d005747c33bae6363cf50c3d5043404a1fe7de42`, with the prompt changes present as working files during evaluation. Do not describe the parent commit alone as the tested implementation.
- Actual source fingerprint: `bc534f82cf79f83bfcd060ff8d7445ab512a961d5fb7e927e49cb74c8c08820d`.
- Prompt SHA-256: `85f36a43b27b2d132f09e8267e1ae9bc635f2d9a5dc5fd393959e1574718579f`.
- Each raw artifact records file fingerprints, bundle hash, input hash, model, timing, token usage and tool events. Source stability was checked after each run.

The historical six runs used a deployed Lambda whose investigator source was not recorded. These reruns use a known local bundle; evidence order/IDs also differ from DynamoDB persistence. This is an observational comparison, not a controlled estimate of the prompt's causal effect or model accuracy.

## Runs

| Case / repeat | Raw run | Assessment | Model / tool calls | Duration | Remaining observations |
| --- | --- | --- | --- | --- | --- |
| ATM-1042 / 1 | [2cab3094](prompt-runs/ATM-1042-run_2cab3094-eb84-401b-af4e-fa620f0fc565.json) | supported | 3 / 8 | 10.44 s | Precise provider statuses and acknowledgement. Ten limitation entries; recommendation asks about follow-up deliveries after acknowledgement, which may be unnecessary. |
| ATM-1042 / 2 | [5c05af36](prompt-runs/ATM-1042-run_5c05af36-608c-4cc2-b247-a7fb85390880.json) | supported | 3 / 8 | 9.06 s | No observed channel overstatement. Ten limitation entries; attendance-proof question may distract from the receipt claim. |
| ATM-1043 / 1 | [4a0296c8](prompt-runs/ATM-1043-run_4a0296c8-072e-4755-b3c4-ec144761911a.json) | mixed | 3 / 8 | 7.99 s | Bounces and failed SMS preserved; retry bounce cites retry. Twelve limitation entries. |
| ATM-1043 / 2 | [0891d8d5](prompt-runs/ATM-1043-run_0891d8d5-208f-4542-935d-ba740934ebb0.json) | mixed | 3 / 8 | 7.94 s | Same core factual boundaries preserved. Twelve limitation entries. |
| ATM-1044 / 1 | [241029b5](prompt-runs/ATM-1044-run_241029b5-07f9-4d26-a1a1-3cb9499d33d0.json) | insufficient | 8 / 8 | 12.98 s | Receipt stays unresolved; 17 repetitive limitation entries. |
| ATM-1044 / 2 | [b74bed9f](prompt-runs/ATM-1044-run_b74bed9f-1bf9-4d6d-b3fc-b704627e39a9.json) | insufficient | 8 / 8 | 11.15 s | Order-only issuance citation; “No scan records exist” is too broad; 15 limitation entries. |

The source-level observations above were made by Codex against the fixture and raw outputs. **Human sign-off remains unrecorded.** No operator preparation/correction time was measured. Model duration is not operator time saved.

## Original issues, reassessed

| Issue | Rerun observation |
| --- | --- |
| Overstated delivery | Not observed in the two ATM-1042 reruns. Email acceptance, provider-marked SMS delivery and acknowledged access remain distinct. |
| Invented nonattendance | Not observed. No new customer claim of nonattendance was added. |
| Wrong resend citation | Both ATM-1043 retries cite `email_demo_1043_retry`. Citation support is still imperfect elsewhere; see below. |
| Wrong ATM-1043 label | Both mixed. |
| Unstable ATM-1044 label | Both insufficient. |
| Outcome/refund advice | Not observed; recommendations concern evidence. Some evidence requests remain poorly focused. |
| Wrong local event date | Not exercised: the model omitted event dates. Regression examples distinguish local November 3 from explicitly labeled November 4 UTC. |
| Repetitive limitations | Still present. Model gaps overlap supplied limitations, and the application itself appends overlapping unavailable-section messages. Prompt-only instructions do not remove this. |
| Recap instead of response | All six open in the merchant's response voice. This does not establish that every draft is submission-ready. |

## What still needs work

1. **Claim-to-source precision.** ATM-1044 repeat 2 says “The order shows two tickets were issued to The Late Set” citing `case_atm_1044:order`. That record describes a paid order linked to two tickets; the issuance facts are in `ticket-1` and `ticket-2`. Later sentences cite those correctly, but they do not fix the first sentence's source association. A regression check and positive/negative test now cover this pattern. This check runs offline, not in production.
2. **Scope absence wording.** The same run says “No scan records exist to confirm ticket usage.” The fixture establishes unavailable scan coverage and `scanRecorded: false` in the selected ticket records. Prefer “no scan is recorded in the selected records,” without asserting that no records exist anywhere.
3. **Limitations presentation.** The existing adapter supplies stock limitations and `completeReport` appends unavailable-section messages. Exact-string deduplication does not combine overlapping meanings. A later deterministic presentation change should consolidate these without dropping substantive caveats; a prompt alone is insufficient.
4. **Evidence-review focus.** Attendance and post-acknowledgement delivery requests can be unnecessary for a ticket-receipt complaint. Reviewers still need to remove irrelevant requests.

## Reproduce and verify

```sh
npm run check
node docs/evaluation/run-prompt-evaluation.mjs --repeats=2
node docs/evaluation/review-prompt-runs.mjs
```

The middle command makes real paid model calls using existing AWS credentials. It never deploys or writes shared application data. The last command is offline and writes [regression-audit.json](prompt-runs/regression-audit.json). Raw outputs and their initial checks remain unchanged. The initial checker incorrectly flagged negated delivery assertions in both ATM-1044 runs; the current audit supersedes those preliminary signals, and tests preserve the correction. It also adds the newly observed issuance-citation check.

Validation completed: full `npm run check` (56 Node tests, 98 Vitest tests at that point, frontend and Lambda builds); after two additional evaluator regressions were added, all **100 Vitest tests**, type checking and targeted lint passed. One pre-existing unused-variable lint warning in `tests/investigation.test.ts` remains. The earlier 13 browser tests concern the baseline local sample workflow, not this live prompt revision. No deployed smoke test or new browser run is claimed.
