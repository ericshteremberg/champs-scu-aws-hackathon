# Causality evaluation results

Owner: teammate 3 (`codex/demo-evaluation`). Last edited: 2026-11-07.

This file separates three things: what the fixtures say (written before looking at any model output), what each run produced, and what a reviewer decided. Every input is a fictional fixture from [`lib/ticket-demo.ts`](../../lib/ticket-demo.ts). None of it is ATMSPHR customer evidence, and nothing here measures savings, accuracy across real cases, or dispute outcomes.

## Status summary

| Case | Fixture reviewed | Run | Source-level review | Outcome |
| --- | --- | --- | --- | --- |
| ATM-1042 | Yes (2026-11-07) | **Not run** | **Not run** | **Not run** |
| ATM-1043 | Yes (2026-11-07) | **Not run** | **Not run** | **Not run** |
| ATM-1044 | Yes (2026-11-07) | **Not run** | **Not run** | **Not run** |

"Not run" means no investigation has been executed and reviewed for this evaluation. The baseline in `docs/handoffs/` reports a real Bedrock investigation passing end to end, but that run is not scored here because it was not reviewed claim by claim against these expected facts.

Application commit when this table was written: `62f3adc` (baseline application commit `e78d7a1`).

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

| Case | App commit | Date | Model / mode | Input provenance | Run ID | Observed findings | Incorrect or missing claims | Correction effort | Reviewer | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATM-1042 | | | | synthetic fixture | | | | | | **Not run** |
| ATM-1043 | | | | synthetic fixture | | | | | | **Not run** |
| ATM-1044 | | | | synthetic fixture | | | | | | **Not run** |

Mode vocabulary (use exactly one per run): `live Bedrock` (with model ID, e.g. `us.amazon.nova-2-lite-v1:0`), `deterministic sample`, `recording replay`.

## Source-level review log

For each material finding in a run, open the original source and judge whether it supports the sentence. A valid citation shows only that the record was retrieved.

| Case | Run ID | Finding (quoted) | Cited source ID | Source supports the sentence? (yes / partly / no) | Notes | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Issues to route

Reasoning failures go to Aiden; interaction problems go to Eric. Include case, expected behavior, observed behavior and source IDs. Rerun affected cases after a fix.

| Date | Case | Type (reasoning / interaction) | Sent to | Expected | Observed | Source IDs | Rerun result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

## Disclosed limitations

- All inputs are fictional. Three cases cannot establish accuracy, win rates, recovered revenue, or time savings.
- No preparation-time measurement exists yet, so no savings figure is claimed anywhere in the submission materials.
- Production ATMSPHR evidence and Stripe submission are not connected.
- Live runs call paid AWS services and change shared synthetic records; they require coordination with Aiden.
- Citation validity is not claim validity. Only the source-level review log above counts as a check of support.
