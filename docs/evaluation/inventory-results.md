# Fact inventory evaluation

Evaluated November 7, 2026 Pacific using real Bedrock `us.amazon.nova-2-lite-v1:0` in `us-east-1`, with fictional ticket fixtures only. No deployment, shared-workspace mutation, provider submission or customer message occurred.

## Final live batch

Batch `a0b96d2c-01c8-471a-a5a6-f9a4babb102b` ran each of three cases twice. All six completed with one model presentation call and eight code-owned evidence reads. [The offline audit](inventory-runs/inventory-audit.json) rebuilt each inventory from its raw evidence and reproduced the entire outgoing response exactly. Every returned plan passed the eligible-fact checks; no model-authored prose or citations entered the response.

| Case | Repeat 1 | Repeat 2 | Internal assessment | Facts / selected | Packet readiness |
| --- | --- | --- | --- | --- | --- |
| ATM-1042 | [8f3561d2](inventory-runs/ATM-1042-run_8f3561d2-0034-4dbd-ae5f-497c28f6cd9a.json) | [b19633f3](inventory-runs/ATM-1042-run_b19633f3-aa6f-4ab3-afc6-da555554add9.json) | supported | 13 / 9 | Review required; seven supporting source exhibits |
| ATM-1043 | [1c649878](inventory-runs/ATM-1043-run_1c649878-50c8-41d2-b451-bcf42ab79e09.json) | [eeac9bc6](inventory-runs/ATM-1043-run_eeac9bc6-08ca-45a0-b561-06ec1890911a.json) | mixed | 12 / 0 | Needs affirmative evidence; no substantive argument invented |
| ATM-1044 | [3d5b6888](inventory-runs/ATM-1044-run_3d5b6888-3908-4fb9-b851-f61dbd614aa4.json) | [6f792fe8](inventory-runs/ATM-1044-run_6f792fe8-d009-45c9-bed7-2740ed53def3.json) | insufficient | 7 / 0 | Needs affirmative evidence; payment/issuance are not treated as receipt |

All cases retain the merchant-selected `challenge_all` preparation policy. Evidence strength and packet readiness remain separate from that policy. Weak or contradictory records remain in internal review and are not dumped into the outgoing letter. Necessary qualifications accompany selected claims. Empty-support review packets are **not** successful substantive appeals or evidence of likely wins.

## Provenance and interpretation

- Parent source commit at evaluation: `a84012c52705318f104eae00bc7b2674213293ed`, with the inventory implementation in working files. The parent commit alone does not identify the tested code.
- Actual bundled source fingerprint: `c5794393136b237a1d63c4d5e5086d3a7cfac536889c74b886a09fe9ac0d01dc`.
- Presentation prompt SHA-256: `4485a6381c9920cac423f98f07167286e28f693221a0dde8e2021fbb70db7e15`.
- Raw artifacts contain file hashes, input hashes, prompt hash, token usage and event traces. Source stability was checked for each run. Twelve earlier development runs are retained in the same directory; the summary/audit select the final batch explicitly.
- The model only arranges IDs now. A clean model-output audit establishes mechanical claim control, not source authenticity, semantic completeness, claim-rule correctness, general model accuracy or improved dispute outcomes.

The historical [free-prose prompt evaluation](prompt-results.md) is retained for comparison. The new engine no longer accepts the old report shape from the model. It retrieves all eight source sections in code and renders selected statements itself. Source dates and gap formatting are now deterministic. It does not use another model's approval as proof.

## Software and CLI verification

- Full application checks passed with **56 Node tests and 124 investigation/AWS unit tests**, type checking, frontend build and Lambda build after merging main through `9e8e473`.
- Regression coverage includes wrong-order records, queue versus provider events, acknowledgement field requirements, forged prose/citations/labels, unknown/duplicate/omitted fact IDs, wrong sections, date/timezone handling, unknown schemas, cancellation and finite correction attempts.
- The CLI's five regression tests cover source hashes, selected versus internal material, empty-support packets, original image byte preservation, cross-case input rejection, unselected file rejection, overwrite protection and HTML escaping. Root CI tests use `--no-screenshots`; screenshot generation was additionally exercised with real local Chrome.
- The [fictional packet example](packet-example/README.txt) contains seven text exhibits and seven clearly labeled transcript PNGs. The acknowledgement and SMS renders were visually inspected. They are not original customer screenshots. Supplied original-image copying and its hashes are tested separately.
- Final browser acceptance passed all 13 tests, including human-edit labeling and mobile layout. Both API suites and the separate adapter's type check and 90 tests passed. Details are recorded in the contributor handoff.

Reproduce a new paid live batch with `node docs/evaluation/run-prompt-evaluation.mjs --repeats=2`, then audit offline with `node docs/evaluation/review-inventory-runs.mjs`. New inventory runs are written to `inventory-runs/`; the older `prompt-runs/` directory is left unchanged.

## Remaining accuracy work

The outgoing statements cannot be rewritten by the model, but a faulty source field or rule can still produce an inaccurate sentence. The current ATMSPHR adapter does not supply all affirmative fields used by the fictional fixtures, so production coverage is limited. Contradictory free text, chronology, other reason codes, scan interpretation, source authenticity and selection completeness need further expert review. The request is addressed to Aiden in [the review note](../handoffs/05-fact-inventory-review.md); no human sign-off or measured real-case outcome is claimed.
