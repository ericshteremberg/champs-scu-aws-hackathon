# Reference responses for evaluation

These are editor-written examples for the fictional fixtures, prepared by Codex against `lib/ticket-demo.ts`. They are neither model reruns nor human-approved packets. They do not replace the saved raw outputs or fix the application. Bracketed references below are the fixture's original source IDs; the application uses different, run-scoped citation IDs.

Use them to judge factual boundaries and response style, not to demand identical wording. The assessment labels follow the rubric in `results.md`, which is now included in the revised application prompt; see [the live rerun](prompt-results.md).

## ATM-1042 — supported

We provide the following records in response to the claim that two tickets were never received. A USD 92.00 payment was captured for order ATM-1042, and two tickets were issued for that order. [pi_demo_atm_1042] [order_demo_1042] [ticket_demo_1042_a] [ticket_demo_1042_b]

The confirmation email was accepted for processing by the email provider; inbox delivery and reading are not recorded. The ticket-link SMS was marked delivered by its provider, which does not establish reading. [email_demo_1042] [sms_demo_1042]

The customer initially asked for help finding the tickets. After the organizer supplied recovery instructions, the customer wrote, “Found both tickets in my account for ATM-1042. Thank you.” A separate recovery record shows a completed flow for two tickets. These records support acknowledged account access, independently of the email's delivery status. [thread_demo_1042:message_1] [thread_demo_1042:message_2] [thread_demo_1042:message_3] [recovery_demo_1042]

Attendance and purchase-time policy records are unavailable in the fixture. We make no claim about attendance, SMS reading, email receipt or a bank decision.

**Evidence next step:** Use the customer acknowledgement and recovery record as the primary access evidence. Preserve the separate provider statuses and disclose the missing attendance and purchase-time policy records.

## ATM-1043 — mixed

We provide the records available for the customer's complaint that the ticket email never arrived and that they contacted support before the event. Payment of USD 75.00 was captured for order ATM-1043 and one ticket was issued. Issuance alone does not establish receipt. [pi_demo_atm_1043] [order_demo_1043] [ticket_demo_1043]

The recorded confirmation email bounced with a mailbox error, and the ticket-link SMS was undelivered. The customer contacted support before the event. The organizer promised another attempt and requested a resend; the retry email also bounced. The resend request and the retry outcome are separate records. [email_demo_1043] [sms_demo_1043] [thread_demo_1043:message_1] [thread_demo_1043:message_2] [resend_demo_1043] [email_demo_1043_retry]

These listed attempts support the customer's delivery complaint. They do not establish that every possible delivery route failed. No successful recovery or later receipt acknowledgement is available in the selected records. The customer did not claim nonattendance in the dispute summary, and attendance cannot be inferred. [dp_demo_atm-1043]

**Evidence next step:** Include the bounces, undelivered SMS and pre-event complaint. Obtain any later order-linked delivery, recovery or acknowledgement records if available; otherwise disclose their absence. Make no recommendation about refunds, escalation or the dispute outcome.

## ATM-1044 — insufficient

We can confirm a USD 118.00 captured payment linked to order ATM-1044 and two issued tickets for The Late Set. These records establish payment and issuance, not receipt. [pi_demo_atm_1044] [order_demo_1044] [ticket_demo_1044_a] [ticket_demo_1044_b]

The customer reports being charged but unable to find tickets or confirmation. Delivery, resend/recovery and matched support records are unavailable in this fixture. We cannot establish either successful delivery or failed delivery from those gaps. [dp_demo_atm-1044]

Attendance and purchase-time policy records are also unavailable. If an event date is needed, the order's `2026-11-04T05:00:00Z` is **November 3, 2026 at 9:00 PM America/Los_Angeles**, not November 4 local time. [order_demo_1044]

**Evidence next step:** Obtain order-linked provider delivery events, recovery history and any matched customer acknowledgement. Until then, describe receipt as unresolved and make no prediction about which side should win.

## Concise limitations for the review exercise

This is an editorial grouping for rehearsal, not a change to the application's generated gaps:

- ATM-1042: email inbox delivery and SMS reading are unknown; attendance and purchase-time policy are unavailable.
- ATM-1043: only the listed delivery attempts and two selected support messages are verified; other routes, later acknowledgement, attendance and purchase-time policy are unverified or unavailable.
- ATM-1044: delivery, recovery and matched support history are unavailable; attendance and purchase-time policy are unavailable. Missing records establish neither receipt nor failure.
