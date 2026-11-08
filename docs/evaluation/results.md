# Causality evaluation results

Owner: teammate 3 (`codex/demo-evaluation`). Last edited: 2026-11-07.

This file separates three things: what the fixtures say (written before looking at any model output), what each run produced, and what a reviewer decided. Every input is a fictional fixture from [`lib/ticket-demo.ts`](../../lib/ticket-demo.ts). None of it is ATMSPHR customer evidence, and nothing here measures savings, accuracy across real cases, or dispute outcomes.

## Status summary

| Case | Live Bedrock runs | Claim-level review (AI-assisted, against fixtures) | Human sign-off | Outcome |
| --- | --- | --- | --- | --- |
| ATM-1042 | 2 (both completed) | Done | **Pending** | **Needs correction**: core facts kept, but delivery is overstated |
| ATM-1043 | 2 (both completed) | Done | **Pending** | **Needs correction**: counterevidence kept, but an unsupported "did not attend" claim appears in both runs |
| ATM-1044 | 2 (both completed) | Done | **Pending** | **Acceptable on evidence claims**; advisory text and one label overreach |

Headline: across six live runs, no run claimed receipt or failed delivery for ATM-1044 from missing history, and no run omitted ATM-1043's counterevidence. All 53 citations resolve to real records in their case. The failures are in what the cited sentences claim, which is the gap the handoff warns about: a valid citation shows membership, not support.

These are two runs per case on a model that is not deterministic. Two runs show which problems repeat; they do not estimate a rate. Nothing here supports a claim about accuracy on real cases.

"Human sign-off" is still open because the reviewer for this file so far is Kiro (AI-assisted) comparing outputs to the fixture text. The handoff asks for review of the original source behind each material finding by a person with Aiden. Treat the verdicts below as a prepared checklist for that session, not as final.

Repository commit when the runs were made: `994158b` (application code unchanged from `62f3adc`; baseline `e78d7a1`). The deployed backend Lambda is a separate artifact: `causality-hackathon-backend`, code SHA-256 `rX+Z9iqF7AqE+qKr84Q6sa6m5+lNdOx8LFnXwaZkSfs=`, last modified 2026-11-08T01:36:07Z. That is about 40 minutes before the runs, so someone redeployed it. Which source commit that deployment came from is not recorded in the Lambda configuration and has not been verified.

## Expected evidence facts

Taken from the fixtures only. The "Source IDs" are the `originalSourceId` values a correct citation can point to.

### ATM-1042: two tickets, customer later acknowledged access

Dispute reason `product_not_received`, USD 92.00 (subtotal 80.00 + fees 12.00), two tickets, event `After Hours: Fall Session`.

| # | Fact the response should preserve | Source IDs |
| --- | --- | --- |
| 1 | Payment `pi_demo_atm_1042` was captured and maps to order ATM-1042; no refund recorded. | `pi_demo_atm_1042`, `order_demo_1042` |
| 2 | Two tickets were issued and linked to the order. Issuance alone does not establish delivery. | `ticket_demo_1042_a`, `ticket_demo_1042_b` |
| 3 | The confirmation email was **accepted** by the provider; inbox delivery and reading are not recorded. | `email_demo_1042` |
| 4 | The ticket-link SMS was marked **delivered**; reading is not established. | `sms_demo_1042` |
| 5 | An order-linked ticket recovery completed (2 tickets recovered). This records account access, not attendance. | `recovery_demo_1042` |
| 6 | Chronology of the matched support thread: the customer first said they could not see the tickets (18:08Z), the organizer explained recovery (18:09Z), and the customer then said "Found both tickets in my account" (18:12Z). | `thread_demo_1042:message_1`, `:message_2`, `:message_3` |
| 7 | Unknown, not negative: attendance/scan coverage and the purchase-time policy are unavailable. | attendance and policy limitations |

Failures to flag:

- Treating "email accepted" as proof of receipt.
- Ignoring the customer's direct acknowledgement (`message_3`), or citing only the early complaint (`message_1`) and presenting it as the customer's final position.
- Using missing scan records to deny attendance or to erase evidence of ticket access.
- Claiming the customer read the SMS, or claiming a bank decision, cardholder identity, or attendance.

### ATM-1043: delivery failed, customer asked for help before the event

Dispute reason `product_not_received`, USD 75.00 (subtotal 70.00 + fees 5.00), one ticket, event `Warehouse Sessions`.

| # | Fact the response should preserve | Source IDs |
| --- | --- | --- |
| 1 | Payment `pi_demo_atm_1043` was captured and maps to order ATM-1043. | `pi_demo_atm_1043`, `order_demo_1043` |
| 2 | One ticket was issued in the application. No customer acknowledgement of access is recorded. | `ticket_demo_1043` |
| 3 | The confirmation email **bounced** (`mailbox_unavailable`). | `email_demo_1043` |
| 4 | The ticket-link SMS was **undelivered** (code `30003`). | `sms_demo_1043` |
| 5 | The organizer promised a resend and requested one; the resent email **also bounced**. A requested resend is not a successful delivery. | `thread_demo_1043:message_2`, `resend_demo_1043`, `email_demo_1043_retry` |
| 6 | The customer reported the missing delivery before the event (11-04 11:40Z), referencing the order explicitly. | `thread_demo_1043:message_1` |
| 7 | No recovery record exists; that does not prove the customer never accessed the account. The listed attempts do not prove every possible route failed. The support export holds two messages and other conversations are unverified. | delivery, history and support limitations |

Failures to flag:

- Omitting counterevidence: the bounces, the undelivered SMS, or the pre-event complaint.
- Treating the resend request as successful delivery.
- Asserting that every possible delivery route failed, or that the customer never accessed the account.
- Recommending a position that disregards the evidence supporting the customer's complaint.

### ATM-1044: payment and issuance only

Dispute reason `product_not_received`, USD 118.00 (subtotal 100.00 + fees 18.00), two tickets, event `The Late Set`.

| # | Fact the response should preserve | Source IDs |
| --- | --- | --- |
| 1 | Payment `pi_demo_atm_1044` was captured and maps to order ATM-1044. | `pi_demo_atm_1044`, `order_demo_1044` |
| 2 | Two tickets were issued. No receipt acknowledgement accompanies them. | `ticket_demo_1044_a`, `ticket_demo_1044_b` |
| 3 | Delivery, resend/recovery history and matched support records are **unavailable**. Neither delivery success nor failure can be established. | delivery, history and support limitations |
| 4 | The customer's complaint appears only in the dispute summary. | `dp_demo_atm-1044` |
| 5 | Attendance and purchase-time policy are unavailable. | attendance and policy limitations |

Failures to flag:

- Claiming receipt, or claiming failed delivery, from absent history.
- Treating ticket creation as delivery.
- Stating a confident conclusion instead of insufficient evidence plus the sources still needed.

## Fixture self-check

I read the fixtures for internal consistency while writing the tables above. Amounts add up (subtotal + fees = total) for all three. Timing to keep in mind during review: ATM-1042's event (2026-11-07 05:00Z) starts after its dispute opened (2026-11-06), while ATM-1043's (2026-11-06 05:00Z) and ATM-1044's (2026-11-04 05:00Z) started before theirs opened. Check any "before the event" wording against `eventStartsAt` rather than assuming it. I found no fixture error, but I have not exercised the fixtures against the application beyond the existing automated tests.

## Run log

One row per actual run. Do not fill in rows by guess. Leave a field as "not recorded" if it was not captured.

All runs: mode `live Bedrock`, model `us.amazon.nova-2-lite-v1:0`, input = synthetic fixtures from `lib/ticket-demo.ts` seeded into a fresh throwaway workspace (isolated from the shared team workspace; nothing approved, archived or uploaded). Dates are UTC, 2026-11-08 (evening of 2026-11-07 Pacific). Raw drafts, evidence and event traces are saved in [`runs/`](runs/), one JSON file per run, made by [`run-evaluation.mjs`](run-evaluation.mjs).

| Case | Run ID | Started (UTC) | Label | Model calls / tool calls / ms | Records / citations | Incorrect or missing claims (see review log) | Correction effort | Reviewer | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATM-1042 | `run_4994c4ec-f80a-4fd6-afc4-a8cdeb118112` | 02:18:41 | supported | 9 / 8 / 21054 | 11 / 10 | Summary says tickets "were delivered"; recommendation vague ("closing the dispute as unresolved... or as supported") | Not timed. About 2 sentences to rewrite | Kiro (AI-assisted); human pending | Needs correction |
| ATM-1042 | `run_7312fd8d-fed8-4ad1-a4f5-02e94de58373` | 02:20:28 | supported | 9 / 8 / 19279 | 11 / 10 | Body: "The customer received the tickets electronically"; summary: "issued and delivered via email and SMS"; recommends submitting "delivery confirmations" and contesting | Not timed. About 4 sentences to rewrite | Kiro (AI-assisted); human pending | Needs correction |
| ATM-1043 | `run_501011c7-bb63-4426-97ea-6ac5e776f6e2` | 02:19:09 | insufficient | 9 / 8 / 18334 | 10 / 10 | "...and therefore did not attend the event" (not in the claim); "A resend was requested, but it also failed" cites the resend request, not the bounce | Not timed. About 3 sentences to rewrite | Kiro (AI-assisted); human pending | Needs correction |
| ATM-1043 | `run_333a1996-3414-449c-ac61-584b72f8a94e` | 02:20:49 | insufficient | 9 / 8 / 18667 | 10 / 10 | Same "therefore did not attend" claim; recommendation built around whether the customer attended; "not delivered" stated flatly in the recommendation; "escalated to a higher authority" | Not timed. About 4 sentences to rewrite | Kiro (AI-assisted); human pending | Needs correction |
| ATM-1044 | `run_4b86ef67-a930-4c7a-b159-a052d45599a7` | 02:19:29 | **supported** | 8 / 8 / 14364 | 5 / 5 | Label contradicts the body; recommendation to "consider offering a refund or resending tickets"; event date given as November 4 (the UTC date; local is November 3) | Not timed. About 2 sentences plus the label | Kiro (AI-assisted); human pending | Acceptable on evidence claims; label and advice need fixing |
| ATM-1044 | `run_89a52312-0d86-4eed-aaa7-0d014e3a3188` | 02:21:09 | insufficient | 9 / 8 / 19423 | 5 / 8 | Recommendation predicts the outcome ("the dispute may lean toward the customer", "balance of probabilities") | Not timed. About 1 sentence | Kiro (AI-assisted); human pending | Acceptable on evidence claims |

"Correction effort" is an estimate of sentences to change, counted by reading. It is not a measured preparation or correction time, and no time-savings claim can be built on it.

Mode vocabulary (use exactly one per run): `live Bedrock` (with model ID, e.g. `us.amazon.nova-2-lite-v1:0`), `deterministic sample`, `recording replay`.

### What held up, per expected fact

| Case | Expected facts preserved in both runs | Not preserved |
| --- | --- | --- |
| ATM-1042 | 1 payment, 2 tickets, 3 email accepted (not claimed as inbox delivery in the body), 4 SMS delivered, 5 recovery completed, 6 support chronology (complaint, then recovery guidance, then acknowledgement) | 3 and 7 in effect: both summaries say "delivered"; run 2's body says "received". The same drafts' limitations section still says "Email acceptance does not prove inbox delivery", so run 2 contradicts itself. Attendance and policy are called unknown, not negative, which is correct |
| ATM-1043 | 1 payment, 2 ticket issued, 3 email bounced, 4 SMS undelivered, 5 resend promised, requested and failed, 6 pre-event complaint with order reference, 7 the limitations section says the attempts "do not prove that every possible delivery route failed" and that missing recovery history "does not prove the customer never accessed the account" | The narrative body and recommendation do not use those limits; run 2's recommendation states the ticket was "not delivered to the customer" without them |
| ATM-1044 | 1 payment, 2 tickets issued, 3 delivery, history and support unavailable, 4 complaint appears only in the dispute summary, 5 attendance and policy unavailable. Neither run claimed receipt or failed delivery | None on evidence facts |

## Source-level review log

For each material finding in a run, open the original source and judge whether it supports the sentence. A valid citation shows only that the record was retrieved.

| Case | Run ID | Finding (quoted) | Cited source ID | Source supports the sentence? | Notes | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| ATM-1042 | `run_7312fd8d` | "The customer received the tickets electronically and acknowledged access" | `email_demo_1042`, `sms_demo_1042`, `thread_demo_1042:message_3` | **Partly** | The customer acknowledged finding tickets *in their account* after recovery (`message_3`, `recovery_demo_1042`). The email was only accepted. SMS delivered is a provider status. "Received electronically" is not established | Kiro (AI); human pending |
| ATM-1042 | both | "tickets were delivered" (summary, no citation; related records below) | `email_demo_1042`, `sms_demo_1042` | **Partly** | SMS marked delivered supports SMS delivery. Email acceptance does not support delivery | Kiro (AI); human pending |
| ATM-1042 | both | Customer "initially reported not seeing the tickets, then acknowledged finding both" | `support-1`, `-2`, `-3` | **Yes** | Chronology matches 18:08Z, 18:09Z, 18:12Z. "After using a recovery link" is an inference backed by `recovery_demo_1042` at 18:10:41Z | Kiro (AI); human pending |
| ATM-1042 | `run_7312fd8d` | "the merchant can contest the dispute based on delivery and access confirmation" | none (recommendation); related: `sms_demo_1042`, `thread_demo_1042:message_3` | **Partly** | Access confirmation is supported. Delivery confirmation is not. The tool should prepare evidence, not decide how to respond | Kiro (AI); human pending |
| ATM-1043 | both | "...and therefore did not attend the event" | `dp_demo_atm-1043` | **No** | The dispute record says only: "The ticket email never arrived. I contacted support before the event." No fixture claims non-attendance. The model added it | Kiro (AI); human pending |
| ATM-1043 | `run_501011c7` | "A resend was requested, but it also failed" | `resend_demo_1043` | **Partly** | `resend_demo_1043` records the *request*. The failure is recorded in `email_demo_1043_retry`, which this draft cites elsewhere | Kiro (AI); human pending |
| ATM-1043 | both | Delivery attempts by email and SMS failed (bounce, undelivered) | `email`, `retry`, `sms` | **Yes** | Matches `mailbox_unavailable` and code `30003` | Kiro (AI); human pending |
| ATM-1043 | both | Customer contacted support before the event | `thread_demo_1043:message_1` | **Yes** | 11:40Z on 11-04, with the order reference | Kiro (AI); human pending |
| ATM-1043 | `run_333a1996` | "the ticket was issued but not delivered to the customer" (recommendation) | none cited | **Partly** | Failed listed attempts support "not delivered by these routes". Stating it flatly ignores the draft's own limitation that other routes are unverified | Kiro (AI); human pending |
| ATM-1044 | both | Neither receipt nor failed delivery is claimed; delivery, support, attendance, policy are missing | `payment`, `order`, `ticket-1`, `ticket-2`, `dispute` | **Yes** | Exactly the expected behavior | Kiro (AI); human pending |
| ATM-1044 | `run_4b86ef67` | "The order details show two tickets were issued for The Late Set event on November 4, 2026" | `order_demo_1044` | **Partly** | The fixture time is 2026-11-04T05:00Z, which is November 3 at 21:00 in the fixture's America/Los_Angeles zone | Kiro (AI); human pending |
| ATM-1044 | `run_4b86ef67` | "consider offering a refund or resending tickets" | none | **No** | No source supports a refund suggestion, and the product does not issue refunds | Kiro (AI); human pending |
| ATM-1044 | `run_89a52312` | "the dispute may lean toward the customer"; "balance of probabilities" | none | **No** | An outcome prediction. The product prepares evidence and does not decide disputes | Kiro (AI); human pending |

Source IDs are shortened to the trailing part of the evidence ID. Every one resolves in the saved evidence list for its run (0 broken citations in 53).

## Issues to route

Reasoning failures go to Aiden; interaction problems go to Eric. Include case, expected behavior, observed behavior and source IDs. Rerun affected cases after a fix. "Sent to" says drafted until a person actually sends it; I cannot message teammates from this session.

| # | Case | Type | Sent to | Expected | Observed | Source IDs | Repeats? | Rerun result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ATM-1042 | Reasoning | Aiden (drafted, not sent) | Email acceptance is not receipt. Say SMS was marked delivered and the customer found tickets in their account after recovery | Summary says tickets "delivered" in both runs. Run 2's body says the customer "received the tickets electronically" and recommends submitting "delivery confirmations" | `email_demo_1042`, `sms_demo_1042`, `thread_demo_1042:message_3`, `recovery_demo_1042` | 2 of 2 summaries; 1 of 2 bodies | Pending |
| 2 | ATM-1043 | Reasoning | Aiden (drafted, not sent) | Describe the claim as written: the ticket email never arrived and the customer contacted support before the event | Both runs state the customer "therefore did not attend the event", citing the dispute record, which says no such thing. The recommendation then turns on attendance | `dp_demo_atm-1043` | 2 of 2 | Pending |
| 3 | ATM-1043 | Reasoning | Aiden (drafted, not sent) | A citation should support its sentence. "Also failed" should cite the bounced retry | Run 1 cites the resend *request* record for a failure | `resend_demo_1043`, `email_demo_1043_retry` | 1 of 2 | Pending |
| 4 | ATM-1043 | Reasoning | Aiden (drafted, not sent) | Preserve that the evidence supports the customer's complaint, and carry the "not every route" limit into the narrative | Label is "insufficient" in both runs and run 2 says "not delivered" flatly, although the limitations section says other routes are unverified | `email_demo_1043`, `sms_demo_1043`, `email_demo_1043_retry` | 2 of 2 labels | Pending |
| 5 | ATM-1044 | Reasoning | Aiden (drafted, not sent) | Label matches the conclusion: insufficient evidence | Run 1 label is "supported" over a body that says delivery cannot be confirmed. Run 2 is "insufficient". The label is unstable | draft analysis, no single source | 1 of 2 | Pending |
| 6 | ATM-1042, ATM-1044 | Reasoning | Aiden (drafted, not sent) | Do not advise on refunds, closing, contesting or likely outcomes | "consider offering a refund" (1044 run 1); "may lean toward the customer" (1044 run 2); "closing the dispute as unresolved... or as supported" (1042 run 1); "contest the dispute" (1042 run 2); "escalated to a higher authority" (1043 run 2) | none | 5 of 6 runs have such a line | Pending |
| 7 | ATM-1044 | Reasoning | Aiden (drafted, not sent) | State local time zone from the fixture, or avoid dates | "November 4, 2026" is the UTC date; the event is November 3 local | `order_demo_1044` | 1 of 2 | Pending |
| 8 | ATM-1044 | Interaction | Eric (drafted, not sent) | Limitations read cleanly and are not repeated | Run 1 lists 17 limitation lines, many restating each other, with the stock phrase "does not establish that an event did not occur" attached to records that are not about an event | `gaps` list in the draft | Seen in 1044 run 1 | Pending |

## Disclosed limitations

- All inputs are fictional. Three cases cannot establish accuracy, win rates, recovered revenue, or time savings.
- Two live runs per case is a small, informal sample of a non-deterministic model. Repeated problems are reported as repeated; no rate is claimed.
- The claim-level review so far was done by Kiro (AI-assisted) against the fixture text. A human must still confirm each verdict against the original source, preferably with Aiden, before this file is treated as reviewed.
- No preparation-time measurement exists, so no savings figure is claimed anywhere in the submission materials. "Correction effort" above counts sentences and is not a time measurement.
- The deployed backend was redeployed about 40 minutes before these runs. Its source commit is not verified, so results describe that deployment, not necessarily commit `994158b`. After any fix, rerun and record the new Lambda code hash.
- Runs used a fresh throwaway workspace through the backend Lambda's direct API, not the browser. Nothing was approved, exported or archived, and the browser flow was not exercised by these runs.
- Production ATMSPHR evidence and Stripe submission are not connected.
- Citation validity is not claim validity. Only the source-level review log counts as a check of support.
- Not yet done: sending the issues to Aiden and Eric, rerunning after fixes, and the recorded rehearsal.
