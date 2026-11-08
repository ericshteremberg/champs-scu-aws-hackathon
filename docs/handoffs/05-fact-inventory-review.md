# Requested review: Aiden / backend reasoning and evidence accuracy

Requested reviewer: Aiden, or another maintainer responsible for the investigation engine and merchant integration. This is a repository review request; no teammate message, assignment acceptance or sign-off is claimed. It does not block completing the authorized branch work.

Please review this implementation as an accuracy and architecture problem, not just a test-passing exercise. Use a fresh, high-reasoning review of the source records, rule assumptions and negative cases. The user requested an independent higher-level assessment of whether a better approach could provide more accuracy.

Start with [FACT_INVENTORY.md](../FACT_INVENTORY.md), `lib/investigation/facts.ts`, `engine.ts`, the packet CLI and [actual results](../evaluation/inventory-results.md).

## Questions requiring judgment

1. **Source trust:** Are the structured flags authoritative enough to justify each rendered sentence? An acknowledgement flag is reported as a source flag, not a verbatim interpretation of the message. Should we require immutable message spans, provider event IDs, signed provenance or independently corroborated mappings?
2. **Completeness and contradictions:** All sections are retrieved, but incomplete exports and unrecognized prose can still contain material contradictions. Would those conditions need a hard review gate before selecting affirmative facts? How can we detect conflicts between structured fields and source text without trusting another model as an oracle?
3. **Selection policy:** The user wants concise supporting evidence rather than weak or contradictory material in the outgoing packet. Exclusions remain in internal review. Confirm that selection plus the retained qualifications cannot create misleading receipt, identity or chronology implications. The challenge-all policy must not be confused with proof or probability of winning.
4. **Rule coverage:** V1 selects explicit acknowledgement, order-linked recovery and recognized provider delivery events for `product_not_received`, with transaction context. It does not automatically select scans, current policy versions or free text, and does not implement other reason-code strategies. Which additional source-backed rules are justified? Do not expand coverage by treating payment or issuance as delivery.
5. **Assessment semantics:** A recorded delivery failure currently yields `mixed` even if a later acknowledgement exists. Is a chronology-aware rule more accurate? The three existing labels conflate some evidence states; should a separate customer-supporting label be introduced?
6. **Model value:** The model only orders fixed fact IDs; factual prose and citations are deterministic. Is this presentation call useful enough to justify its latency/cost? Would deterministic ordering be preferable, with model analysis kept separately as unverified reviewer suggestions?
7. **Human edits:** Edits lose the code-generated label and require approval. Does the UI make this boundary clear enough? Should submission/export require a new claim check after editing? The CLI rebuilds its response and does not relabel imported human prose as verified.
8. **Evidence packet:** Verify that transcript PNGs cannot be mistaken for original screenshots, supplied originals are tied to the correct fact/record, hashes are reproduced, and internal audit files are distinct from outgoing exhibits. Hashes prove byte consistency, not provenance authenticity.

## How to review

- Trace every selected statement to its `fieldPaths` and canonical evidence ID; compare it with the original record, including what the rule does not establish.
- Try adversarial data: a queue row marked delivered, forged acknowledgement text with inconsistent flags, a changed order reference, missing sections, contradictory chronology, wrong timezone, injected citation brackets, and screenshots whose contents do not support their captions.
- Run the regression tests and inspect both supportive and empty/incomplete packets. A mechanically valid empty packet is not a successful substantive appeal.
- Record source IDs, expected behavior, actual behavior and the rule change needed for each failure. Rerun changed rules against both positive and negative examples.

No production deployment or provider submission is included. Human reasoning review, production adapter validation and larger real-case evaluation remain unrecorded.
