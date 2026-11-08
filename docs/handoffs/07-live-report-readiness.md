# Live report readiness — November 8, 2026

The report engine successfully compiled six attached records in the authenticated shared development app, including independently inspected Stripe, broese-events Supabase, and Resend sources. This was a **manual, case-scoped evidence import**, not proof that automated ingestion works. The saved response remains an internal draft; no Stripe submission, refund, or customer message was performed. Customer records and credentials are intentionally excluded from this handoff.

## Current deployment gaps

| Component | Verified | Still required |
| --- | --- | --- |
| Stripe OAuth | Account authorization exists. A live read exposed valid `du_` dispute and `py_` payment IDs rejected by the verifier. Main now accepts them while preserving account/mode/payment matching. | Deploy the fix. OAuth verification alone does not import disputes. Wire a scoped import through the authorized account token, or configure the existing separately bound restricted-key importer. |
| Supabase | Authorization, project selection and schema inspection work. Eric confirmed `broese-events`. Exact-order read-only inspection matched payment IDs and amounts. | Implement/deploy the broese-specific row adapter with approved columns, case/payment predicates and restricted access. The OAuth connector currently reads schema metadata only. |
| Resend | A stored order message ID opened the exact historical ticket email in the authenticated provider dashboard, matching recipient, order, ticket and amount. | Deploy the merged Resend backend/frontend. The shared site's `/api/providers/resend` currently returns endpoint-not-found. Verify the existing secret ARN/workspace/domain bindings in that deployment. Then preview/import the exact email ID. |
| Report | Bedrock completed the six-record investigation. The reviewer corrected dates and evidence limitations in the saved response. | Deploy classification-gap wording fixes and rerun. Generated findings can still require human correction; a category with no assigned records does not prove the underlying evidence is absent. |

The existing ATMSPHR adapter is **not a drop-in broese-events adapter**. Its README excludes imported Broese orders and its repository uses a different schema (`organizers`, `payment_ref`, `order_email_queue`). Do not point that SQL at broese-events and assume it is compatible.

## Broese mapping verified through scoped reads

- Bind the Stripe dispute's charge and PaymentIntent to `orders.id`, `orders.order_number` and `orders.stripe_payment_intent_id`; validate amount, currency, account and live/test context before import.
- Read only that order's `tickets` by `order_id` and matching event; select status, scan timestamp and transfer references. Never retrieve QR secrets or ticket-access tokens.
- Read `scans` by the selected ticket IDs and event. No scan does not establish nonattendance; invalidated requires its own explanation and timestamp.
- Read `message_log` by exact `order_id`, restricted to email. Use `provider_id` to retrieve the Resend record, then check configured sender domain, exact recipient and order reference. Database `sent` is not provider-confirmed delivery.
- Retain `tos_version` and `refund_policy_snapshot` as stored order facts. They do not establish checkout presentation/acceptance, nor do they independently rebut a quality complaint.

## Smallest completion path

1. Deploy current main to the teammate-owned frontend and AWS runtime, preserving existing secrets and bindings. Recheck authenticated provider endpoints.
2. Verify Stripe read access, then import one explicitly selected dispute using the same account context.
3. Add the case-scoped broese adapter and a restricted server-side database connection or an equivalently constrained authorized query implementation. Do not grant arbitrary browser/model SQL access or use a database-owner/service-role credential as a shortcut.
4. Import the exact Resend email through preview/import. Historical lookup by stored ID works even when list/search date filters do not locate it. Delivery/open status must be verified separately from email content.
5. Run the investigation, inspect citations, dates and counterevidence, and leave it for merchant review. Webhook setup is still incomplete; it is optional for a one-time email lookup but required for future captured event history. It cannot retroactively create missing events.

No high win probability is established. For a quality dispute, the remaining substantive gap is the exact allegation and evidence addressing whether the advertised service was delivered. A transaction-to-email trail supports linkage, not service quality.
