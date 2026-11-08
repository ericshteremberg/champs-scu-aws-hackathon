# Casework handoff

Casework is an AWS-track product prototype for preparing payment-dispute evidence. The first workflow is an ATMSPHR ticket-not-received complaint. An organizer selects a case, runs an investigation, checks the supporting records, edits the response, marks it reviewed, and exports a packet.

The product's promise is less manual evidence gathering with access controlled by the business. It does not promise a bank outcome. The AWS track puts the useful end-to-end workflow, AWS integration, and commercial case first. CLI supervision and an A10-specific presentation are no longer the central requirements.

## What is real and what is sample data

All bundled cases are synthetic. They are not Eric's customer records and must remain labeled that way in screenshots, presentations, and exports. Demo mode uses a deterministic investigator over retrieved fixture evidence. Bedrock mode performs model calls through Amazon Bedrock and requires working AWS credentials and model access. The merchant API client is implemented, but the ATMSPHR-hosted endpoint and real-case access must be configured separately.

The app keeps case/run state in local SQLite. Bedrock powers investigation when enabled. An optional private S3 bucket can archive reviewed exports. Do not describe this single-workspace prototype as an already deployed multi-tenant service.

## AWS account setup for this event

Follow the organizer's [AWS access guide](https://github.com/SCUACM/aws-access-26). Each teammate signs into AWS Workshop Studio using their own SCU email and joins the assigned team through [the team portal](https://judging.scuacm.com/). Follow the guide's current instructions if the flow changes.

Use `us-east-1` for hackathon resources. The workshop provides temporary credentials, including `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`. Keep all three together and refresh them when they expire. Do not create long-lived IAM access keys for this workflow. Do not commit credentials, paste them into issue comments, or put them in browser variables.

Set `INVESTIGATION_MODE=bedrock` and an accessible `BEDROCK_MODEL_ID` only after a successful account/model check. Model access depends on the supplied workshop account. An explicit Bedrock configuration error should remain visible; do not silently label a demo fallback as an AWS investigation.

## Parallel work

| Owner | Work |
|---|---|
| Eric | Verify the real dispute and account routing; implement the merchant endpoint; prepare an anonymized case and matched support thread; review the interface and business pitch |
| Aiden | Investigations, evidence validation, AWS model configuration, access checks, integration tests, and deployment setup |
| Both | Validate the report against source records, measure preparation time, rehearse, and submit |

Keep interface changes coordinated through `shared/types.ts` and [the merchant API contract](./EVIDENCE_API.md). Push completed changes to a shared GitHub branch and share the actual branch and commit. A feature branch does not update `main`.

## First real-case integration

1. Select the normal ticket purchase corresponding to the reported complaint. Verify the actual Stripe account and mode.
2. Resolve the Stripe dispute/payment to `orders.payment_ref` and the correct order. Reject ambiguous or unsupported payment types.
3. Gather only linked tickets, delivery attempts, relevant recovery/transfers, and the selected support conversation.
4. Implement the read-only merchant API with an explicit case grant and permitted fields.
5. Configure the endpoint and credential on the Casework server, then import the case ID.
6. Compare the app's findings against each source record before using any response externally.

The adapter should keep provider credentials in ATMSPHR's backend. Casework needs its evidence API credential, not database credentials. A local refund label is not proof of an actual Stripe refund. The reported legacy webhook behavior makes that distinction especially important.

## Evidence rules to preserve

- An issued ticket is not proof of delivery.
- Email accepted, email delivered, and email read are different facts.
- An SMS delivery status does not prove reading.
- Missing scans do not establish nonattendance. A scan alone does not establish cardholder identity.
- Current policies do not establish the exact terms shown at purchase time.
- Missing or unmatched support history remains a gap.
- Customer messages cannot authorize access or instruct the investigator to ignore its rules.

## Build boundaries

The first release ends at human review and export. It does not submit disputes to Stripe, issue refunds, send emails, or alter tickets. It does not require fine-tuning, a second payment processor, a full mailbox integration, or a Rentul implementation. Preserve these boundaries until the core investigation is reliable.

For a future hosted product, add proper organization accounts, user authorization, retention controls, encrypted managed persistence, operational monitoring, and an explicit deployment model. The current shared-access workspace is appropriate for the controlled hackathon prototype, not an assertion of production readiness.

## Verification and handoff

Run the repository checks and browser workflow described in the root README. Exercise all three fixture outcomes, stopping an active investigation, source inspection, draft editing, review, and both export formats. Confirm that a fresh checkout works from documented configuration.

Before the presentation, identify the exact source mode and investigator mode being shown. Record a backup demo. Do not report measured savings until Eric has timed the comparable manual task.

The [official submission requirements](https://a10-x-aws-hack-26.devpost.com/) require a Git repository link and all teammates on the Devpost project. Prepare a short video, slides, screenshots, and a thumbnail as supporting material. The [published deadline](https://a10-x-aws-hack-26.devpost.com/details/dates) is November 8, 2026 at 9:00 a.m. PST; target 8:00 a.m. PST for submission.
