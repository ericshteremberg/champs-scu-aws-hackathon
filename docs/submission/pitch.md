# Causality pitch

Draft for the AWS x A10 Hack. The presentation and video time limits are **not verified** (see [checklist.md](checklist.md)). The script below is three minutes, adapted from [`../DEMO.md`](../DEMO.md); trim it once the real limit is confirmed. Everything shown uses fictional records unless a row in [`../evaluation/results.md`](../evaluation/results.md) says otherwise.

## One-line description

Causality prepares a payment-dispute response from the records a business already has, with every finding tied to a source the organizer can open and check.

## Problem

An organizer who gets a "ticket not received" dispute has to search payment, ticket, delivery and support systems by hand, then write a response. The work is slow, and a rushed response can misstate delivery or leave out evidence that supports the customer.

## What Causality does

- Takes one dispute case and requests only the evidence sections linked to it from the merchant's own approved-case endpoint.
- Runs an investigation that selects evidence tools, reads the records and drafts findings with citations.
- Shows original source records, missing evidence and limitations beside the draft.
- Requires a human to edit and approve an exact revision before it can be exported or archived.

It does not issue refunds, message customers, decide disputes, or guarantee recovery. Stripe submission is disabled by default and is not part of the demo.

## Architecture (as built)

- Cloudflare serves the frontend and the authenticated bridge.
- A private AWS Lambda handles the API; a separate Lambda runs investigations.
- Amazon Bedrock Nova selects evidence tools and drafts findings.
- DynamoDB stores cases and revisions. S3 stores private attachments and approved archives.
- The merchant-owned API supplies approved case records. Production ATMSPHR evidence is **not connected**; the demo uses synthetic fixtures.

## Script (about three minutes)

| Time | Speaker and action | Notes |
| --- | --- | --- |
| 0:00-0:25 | Eric describes a ticket-not-received complaint and today's manual search across systems. | Spoken only. |
| 0:25-0:45 | Open ATM-1042. Say these are fictional records shaped around the real workflow. Start the investigation. | Say which mode is running: live Bedrock, deterministic sample, or recording. |
| 0:45-1:30 | Show persisted progress and the requested sections. Open the SMS delivery event and the customer's "Found both tickets" message. Say that email *acceptance* does not prove receipt. | Chronology: customer first said they could not see tickets, then acknowledged finding them. |
| 1:30-2:00 | Follow a citation. Show attendance and purchase-time policy as unknown, not negative. Edit one sentence, approve the exact revision, export or archive it. | Say that a valid citation shows the record was retrieved, not that it supports the sentence. |
| 2:00-2:25 | Open ATM-1044. Show the insufficient-evidence result and the sources still needed. | Do not claim receipt or failed delivery. |
| 2:25-2:45 | Walk the architecture above. | One sentence per service. |
| 2:45-3:00 | State the validation plan: measure preparation time with ATMSPHR before claiming savings. | No savings number unless measured. |

If a live model call is slow, switch to the recorded backup and say it is a recording. A deterministic sample or replay must never be described as live AWS inference.

## Claims we make, and claims we do not

Make:

- The workflow runs end to end on fictional ticket cases with source inspection, human approval and archival.
- Evidence is requested per case, per section, from a merchant-controlled endpoint.
- Findings are checked against retrieved sources, and gaps are shown rather than filled in.

Do not make:

- Increased win rates, recovered revenue, automatic refunds, lawsuit prevention, or exclusive market novelty.
- Any time-savings figure. None has been measured.
- That the three fictional cases are customers, pilots or outcomes.
- That any run reflects ATMSPHR production data.

## Likely questions

See the question list in [`../DEMO.md`](../DEMO.md). Short versions:

- *Where is AWS used?* Lambda for the API and jobs, Bedrock for inference, DynamoDB for records, S3 for files and archives.
- *Is it always right?* No. The organizer reviews every claim against its source.
- *Can it see the whole database?* No. The model gets section tools for one fixed case, and the merchant endpoint must filter before responding. ATMSPHR's production endpoint still needs deployment and verification.
- *What is novel?* Automated dispute evidence collection already exists. Our hypothesis is a practical case-scoped integration for custom ticketing data with transparent review; demand is not yet established.

## Submission text (draft)

**Inspiration.** Event organizers get "ticket not received" disputes and must search several systems to answer them.

**What it does.** Causality investigates one dispute case from approved, case-scoped records, drafts a sourced response, shows what evidence is missing, and requires human approval before export.

**How we built it.** Cloudflare frontend and bridge, AWS Lambda API and investigation jobs, Amazon Bedrock Nova for tool selection and drafting, DynamoDB for cases and revisions, S3 for private files and archives.

**Challenges.** Keeping the model honest about absent evidence: acceptance is not delivery, and missing history is neither success nor failure.

**What's next.** Measure preparation time with ATMSPHR, connect a real case-scoped endpoint, and validate a rental workflow separately.

**Data note.** All demo records are fictional.
