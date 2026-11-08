# Merchant evidence API

Casework requests records for an approved case from an API controlled by the merchant. Casework does not need the merchant's database credentials. The integration takes a base URL and a server-held bearer credential. The merchant checks that credential and its case grant on every request.

The repository includes a client for this contract and fictional fixtures. It does not deploy an ATMSPHR Supabase function or establish a connection to Eric's production data. The merchant must implement and verify its adapter before importing a live case.

## Request

```http
GET /v1/cases/case_123/evidence?section=delivery
Authorization: Bearer <merchant-issued-credential>
Accept: application/json
```

Set `MERCHANT_EVIDENCE_URL` to the API base URL, without `/v1/cases`, a query string, or a trailing case path. Set `MERCHANT_EVIDENCE_TOKEN` only on the Casework server. Production requests use HTTPS. HTTP is permitted only for local development on a loopback address. Redirects are rejected.

The `section` parameter is one of `summary`, `order`, `tickets`, `delivery`, `history`, `support`, `attendance`, or `policy`. Unknown sections fail closed. Identifiers use letters, numbers, underscores, and hyphens, with a maximum length of 160 characters.

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

The transport envelope and source-record identifiers use snake_case. The internal app types are camelCase. The `data` object contains `title`, `detail`, and `fields`; values in `fields` are strings, numbers, booleans, or null. Do not put nested database objects into `fields`.

Use stable, case-specific evidence IDs. The client rejects duplicate IDs within a response, mismatched case/section responses, malformed records, and responses larger than 1 MB. Each section has at most 100 records. If source results exceed that limit, return a bounded selection with `status: "partial"` and a clear limitation describing what was omitted. The current client does not follow pagination.

`available` means the returned section has available records within the stated scope. It does not promise a complete account of everything that happened. `partial` identifies known gaps. `unavailable` must return an empty `records` array and should explain why the section is unavailable. An empty scan history cannot establish that a person did not attend.

## Importing a live case

An organizer imports a case ID through Casework. Casework fetches its `summary` section from the merchant. That response includes the envelope above plus two fields:

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

This is an addition to the full summary envelope, not a separate response. The `case` object intentionally follows the camelCase `CaseRecord` schema. Amounts use integer minor currency units and currency is a three-letter uppercase code. Dates are ISO 8601 timestamps with an offset. Case status and run IDs are managed by Casework and cannot be imported.

The summary must also contain a record whose `data.fields.orderRef` and `data.fields.paymentRef` equal the imported case references. Casework checks those references again when investigating a live case. `mapping_verified` is an attestation by the authenticated merchant endpoint, not independent payment verification by Casework.

Before returning that attestation, the merchant must establish the case's merchant/organizer, Stripe account, live/test mode, payment, and order relationship. Do not join solely on an email address. Legacy Stripe accounts and Connect accounts need explicit routing. Membership payments and imported orders may require a different mapping and should be rejected from this ticket-order adapter if they cannot be verified.

## Merchant implementation outline

The following is design pseudocode, not a deployed or production-ready Supabase function:

```text
1. Authenticate the integration credential.
2. Load its approved case grant and check expiry/revocation.
3. Verify the URL case belongs to that grant and the expected merchant.
4. Accept only a known evidence section.
5. Resolve the saved, verified payment-to-order mapping on the server.
6. Run a bounded read query constrained to that merchant and order.
7. Select only permitted fields, then normalize and return them.
8. Audit the request, outcome, and source references without logging secrets.
```

Use a dedicated database role with restricted grants, or carefully restricted database functions. A Supabase service role bypasses row-level security, so using it behind an endpoint does not itself provide database-level restrictions. Credentials, ticket redemption secrets, QR payloads, and unrelated customer history must not be returned. Keep financial writes and customer messaging out of this endpoint.

Return 401 for missing/invalid credentials, 403 for a denied or revoked grant, 404 for an unavailable approved case, and 400 for an invalid section. Avoid error details that reveal other customers' records. A case that exists but has no delivery history should return a valid `unavailable` evidence section.

## Adapter acceptance checks

Verify that changing the case ID, merchant scope, order reference, or Stripe account cannot expand access. Test expired/revoked grants, unsupported sections, unavailable sources, oversized results, and duplicate evidence IDs. Query only relevant records before serialization; filtering an entire database export afterward does not meet the intended design.

For support email, begin with one manually matched conversation containing an order reference or other corroboration. A full mailbox connector is not required. Rentul can later implement the same contract with booking, handoff, return, and linked-message evidence after defining its own section mapping.
