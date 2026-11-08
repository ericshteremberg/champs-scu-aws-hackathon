# Evaluation checkpoint: ready to share, generation defects remain

This checkpoint on `codex/demo-evaluation` adds evaluation tools, source-review material and a current local demo rehearsal. It is not a production-readiness sign-off and does not fix the model's generation behavior.

## Verified

- Fresh local application build and all 13 existing browser tests passed.
- Three fictional ticket cases rehearsed with deterministic sample investigations, source inspection, saved revision approval and synthetic export. Five screenshots and a 36-second silent video are in [artifacts](artifacts/README.md).
- Six historical live Bedrock runs audited offline: 53 citation occurrences, 50 distinct IDs summed per run, no unresolved or unretrieved references. A deliberately broken citation is rejected.
- Evaluation scripts pass syntax and lint checks; local documentation links resolve and `git diff --check` passes.

The live-runner provenance improvement records both Lambda artifacts before and after a run. It has not been exercised against AWS. No new deployment or paid inference was performed for this checkpoint.

## Product issues still open

The saved live outputs overstate delivery, introduce unsupported nonattendance, sometimes cite a source that does not support the sentence, use inconsistent assessments, add outcome/refund advice, and misstate one local event date. Drafts also need better response style and shorter limitations. See the nine reproducible observations in [results.md](results.md) and the corrected editorial [reference responses](reference-responses.md).

These affect the accuracy and usability of responses. Passing browser tests and valid citation membership do not establish claim correctness. Human source-level sign-off and preparation-time measurements remain unrecorded. All inputs are fictional; production ATMSPHR and Stripe submission remain disconnected. Submission work is deferred at the user's request.

## Harness recommendation

Causality already has a bounded investigation loop with case-scoped tools, citation validation, cancellation and revision guards. Extend that loop with an evaluation and output-validation harness before considering a replacement framework:

1. Define the assessment meanings and evidence-only recommendation rules explicitly in the prompt and report contract.
2. Add regression cases for all nine observations, with negative examples as well as the three existing fixtures. Match factual boundaries rather than exact response wording. Keep the rubric's proposed labels distinct from currently enforced behavior.
3. Require material claims to identify the exact supporting records. Check deterministic facts such as provider statuses, amounts and event time zones in code where possible. A citation's existence alone is insufficient.
4. Evaluate a claim-support check over each claim and its cited sources. Bedrock contextual grounding checks are one option to test, not a guarantee or an implemented feature. [AWS documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html)
5. Reject or flag unsupported output, allow a bounded correction attempt, and expose unresolved findings to the reviewer. Validate false positives and preserve the existing approval and stale-result safeguards.
6. Rerun live evaluations against identified API and investigator builds after changes. Report observed failures and improvements without claiming real-case accuracy from three synthetic cases.

The separate untracked Envoy/OPA gateway specification controls whether a Bedrock request is allowed and how it is signed and logged. Its current scope does not validate the model's answer against case evidence. It would help request-policy enforcement, but would not by itself resolve these generation defects. The gateway specs are excluded from this checkpoint.

This note proposes follow-up application work; no harness or guardrail integration is included in this commit.

If Bedrock Guardrails is evaluated, distinguish its content, topic, word, sensitive-information, contextual-grounding and automated-reasoning policies from an application's own validation rules. Integration can use Converse `guardrailConfig`, selective `guardContent` blocks, or a separate `ApplyGuardrail` call. A separate claim-and-source check is the integration to investigate here; its effectiveness must be measured against the saved failures before enabling it.
