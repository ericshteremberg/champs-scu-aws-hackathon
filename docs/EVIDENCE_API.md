# Merchant evidence API

Causality requests records for an approved case from an API controlled by the merchant. The integration does not need the merchant's database credentials. A merchant-issued server credential identifies the connection; the merchant checks its case grant and revocation state on every request.

This repository implements the client and normalization rules. It does not deploy an ATMSPHR Supabase function, create a merchant grant, or connect Eric's production database automatically.

## Configure the connection

Set these values on the private AWS Lambda backend, preserving its infrastructure-provided environment values. They are not frontend variables or browser credentials:

| Variable | Meaning |
| --- | --- |
| `MERCHANT_EVIDENCE_URL` | HTTPS API base URL, without `/v1/cases`, credentials, query, or fragment |
| `MERCHANT_EVIDENCE_TOKEN` | Merchant-issued bearer credential, kept server-side |
| `MERCHANT_WORKSPACE_ID` | Exact Causality workspace authorized to use this connection |

The integrated application requires HTTPS and rejects redirects. A model or browser request cannot override the base URL, token, or workspace binding.

## Request

```http
GET /v1/cases/case_123/evidence?section=delivery
Authorization: Bearer <merchant-issued-credential>
Accept: application/json
```

The section is one of `summary`, `order`, `tickets`, `delivery`, `history`, `support`, `attendance`, or `policy`. Unknown sections must fail closed. The import API accepts external case IDs containing letters, numbers, underscores, and hyphens, up to 160 characters.

## Response

```json
{
  "case_id": "case_123",
  "section": "delivery",
  "source_mode": "live",
  "fetched_at": "2026-11-07T18:00:00Z",
  "status": "partial",
  "records": [
    {
      "evidence_id": "case_123:email_attempt_1",
      "source": "Resend",
      "source_id": "email_reference_1",
      "occurred_at": "2026-11-04T18:03:12Z",
      "data": {
        "title": "Confirmation email accepted",
        "detail": "The provider accepted the message for processing. Inbox delivery and reading are not recorded.",
        "fields": {
          "orderRef": "ORDER-123",
          "channel": "email",
          "providerStatus": "accepted",
          "delivered": null,
          "read": null
        }
      }
    }
  ],
  "limitations": ["No provider delivery or open event is available."]
}
```

The envelope uses snake_case. Each record contains `data.title`, `data.detail`, and `data.fields`. Field values are strings, finite numbers, booleans, or null, with at most 60 fields. Nested database objects are rejected. Field strings are capped at 6,000 characters; record details at 24,000 characters.

Use stable case-specific evidence IDs, up to 240 characters, without square brackets or newlines. Do not reuse an evidence ID for another record or section. Causality derives a workspace/case-scoped internal ID while retaining the original evidence identifier and source reference. Generated citations use those internal IDs, so the report links to the records persisted in the workspace.

The client rejects mismatched case/section responses, duplicate IDs, malformed records, redirects, and responses larger than 1 MB. A section contains at most 100 records; the deployed investigation caps the entire case at 90 source records and 1 MB of normalized context. DynamoDB items are limited to 300 KB and an application transaction to 3 MB, so individual records with large structured fields may be rejected even when the HTTP response is under 1 MB. Return a bounded selection with `status: "partial"` and explicit limitations if the original source is larger. This client does not follow pagination.

`available` means records are available within the stated scope, not that the source proves everything that occurred. `partial` identifies known gaps. `unavailable` must contain an empty records array. Explain unavailable sources in `limitations`. Missing scans cannot establish nonattendance.

## Summary and import metadata

The `summary` response includes the full envelope plus these fields:

```json
{
  "mapping_verified": true,
  "case": {
    "id": "case_123",
    "merchantId": "merchant_123",
    "merchantName": "Example organizer",
    "customerLabel": "Customer 123",
    "claim": "I paid for a ticket but did not receive it.",
    "reason": "Ticket not received",
    "amount": 5000,
    "currency": "USD",
    "eventName": "Example event",
    "purchasedAt": "2026-11-04T18:03:00Z",
    "openedAt": "2026-11-06T20:15:00Z",
    "dueAt": "2026-11-14T07:59:00Z",
    "sourceMode": "live",
    "summary": "One ticket purchase requires evidence review.",
    "orderRef": "ORDER-123",
    "paymentRef": "payment_reference_123",
    "tags": ["Ticket delivery"]
  }
}
```

This is an addition to the summary envelope, not a separate response. The `case` object uses camelCase. Amounts are integer minor currency units; do not assume every currency has two decimal places. Currency is a three-letter code. Timestamps use ISO 8601 with a timezone offset.

The summary must contain a record whose `data.fields.orderRef` and `data.fields.paymentRef` match the case metadata. `mapping_verified` is an attestation by the authenticated merchant endpoint. It is not independent payment verification by Causality.

Before returning that attestation, verify the merchant/organizer, Stripe account, live/test mode, payment, and order relationship. Do not join solely on email. Legacy and Connect accounts need explicit routing. Reject unsupported or ambiguous membership/imported-payment mappings from a ticket-order adapter.

## Causality import and investigation flow

The signed-in operator imports through the existing authenticated API:

```http
POST /api/investigations
Content-Type: application/json
Origin: <Causality origin>

{"action":"import","externalCaseId":"case_123"}
```

Causality verifies the workspace connection, fetches the summary, and creates a local case with its own ID. It saves the merchant ID, external case ID, order reference, and payment reference. The same external case cannot overwrite an existing case in that workspace.

An investigation starts with:

```json
{"action":"start","caseId":"<local-case-id>","mode":"bedrock"}
```

The Lambda API creates a version-guarded run and invokes its private background worker asynchronously. The start response is HTTP 202 with `{ "run": ... }`; the API presents the queued run as `running`. `GET /api/investigations?caseId=<local-case-id>` returns `{ "run": ... }` with persisted events. After completion, reload `GET /api/workspace` to obtain the saved draft and sources. Cancellation uses `POST /api/investigations` with `{ "action": "cancel", "runId": "..." }`.

The frontend bridge authenticates the operator and IAM-signs its invocation of Lambda. Browsers cannot supply trusted user identity directly to a public Lambda URL. The development frontend uses a password-protected shared reviewer workspace; the original Sites identity mode remains separate.

Every remote investigation reads and verifies summary metadata before any other section. The external case, merchant, payment, order, and relevant case metadata must still match the saved binding. The agent selects permitted sections but cannot supply another case ID or arbitrary URL. All source/model boundaries check run activity and captured case/draft revisions.

Retrieved remote records are staged in the Lambda job, mapped to stable internal IDs, and published with the generated draft in a native DynamoDB conditional transaction only if the run remains current. A changed case, draft, approval, or cancelled run prevents stale output from replacing newer work. A merchant-imported case is not automatically bound to a Stripe submission.

## Merchant implementation outline

This is adapter design guidance, not a deployed function:

```text
1. Authenticate the integration credential.
2. Load its approved case grant and check expiry/revocation.
3. Verify the requested case belongs to the grant and expected merchant.
4. Accept only a known evidence section.
5. Resolve the verified payment-to-order mapping on the server.
6. Run a bounded read query constrained to that merchant and order.
7. Select permitted fields, normalize the records, and report source gaps.
8. Audit the decision and source references without logging credentials.
```

Use a restricted database role or carefully restricted database function. Supabase's service role bypasses row-level security, so placing that key behind an endpoint is not itself database-level least privilege. Keep database credentials, QR/redemption secrets, unrelated customer history, financial writes, and messaging outside this endpoint. See [Supabase's access-control documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

Return 401 for invalid credentials, 403 for denied/revoked grants, 404 for an unavailable approved case, and 400 for invalid sections. Error bodies should not expose another customer's records. A valid case without delivery history returns a valid unavailable section, rather than implying delivery failed.

## Acceptance checks

Test changed case IDs, workspace/merchant mismatches, payment/order changes, expired and revoked grants, unsupported sections, unavailable sources, duplicate evidence IDs, and oversized records. Confirm that queries constrain rows before serialization. Fetching a whole database and filtering afterward does not meet the intended design.

Start support integration with one manually matched thread containing an order reference or corroborating facts. Rentul can later supply booking, handoff, return, and related-message records after defining its own evidence semantics.
