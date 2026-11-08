# Selected disputes and linked evidence

Connections now supports a customer-driven Stripe-to-Supabase evidence workflow without a merchant-hosted endpoint. The customer authorizes both providers, selects a Supabase project, approves evidence columns, and saves a direct order mapping in the app. The backend uses the existing private AWS Lambda, DynamoDB workspace partition, and OAuth refresh lifecycle. Cloudflare remains the authenticated frontend/API bridge. No new external service or dependency is added.

## Customer workflow

1. In Connections, connect Stripe and Supabase. Confirm Stripe's account/environment. Select the intended Supabase project and approve only evidence columns.
2. Under **Disputes and linked evidence**, load the ten latest Stripe disputes. Select a dispute awaiting a response and choose **Import and open case**. This imports one local case and a verified Stripe payment record. Reimport opens the existing case without overwriting local work.
3. Return to Connections. Choose an order table, its unique order ID, and the field containing the Stripe PaymentIntent (`pi_`) or charge (`ch_`). Select the fields to include, including both ID columns.
4. Optionally add up to three direct related tables for tickets, delivery, history, attendance or support. Each must contain a column referencing the unique order ID. Select the evidence fields, including that link column, then save the mapping.
5. Select the imported case and choose **Preview linked records**. Review the returned fields and limitations. **Import reviewed records** adds that exact snapshot, clears prior draft approval and opens the case for investigation.

The app does not infer business relationships from similar column names. Composite tenant keys, indirect joins, nested JSON, and encrypted/encoded payment references require a later mapping extension or the existing merchant endpoint connector. A missing order or ambiguous payment match is an error, not evidence that a customer is wrong. Email can be added separately through Gmail or IMAP after the customer connects a mailbox.

## Server boundary

`GET /api/providers/evidence` returns the current valid mapping and eligible imported case IDs. `POST` accepts one strict action:

| Action | Input | Effect |
| --- | --- | --- |
| `stripe_disputes` | action only | Reads ten sanitized dispute summaries with the customer token |
| `import_stripe_dispute` | dispute ID, `confirmed: true` | Re-reads the dispute and charge; creates an idempotent local case |
| `save_mapping` | mapping, `confirmed: true` | Rechecks schema and approved scope; saves mapping without reading customer rows |
| `preview_records` | owned mutable case ID | Re-verifies its payment, queries linked rows and stores a ten-minute preview |
| `import_records` | case ID, preview ID, `confirmed: true` | Atomically imports the stored snapshot; accepts no caller-supplied evidence |

- `aws/stripe-oauth-api.ts` accepts both `du_` and `dp_` dispute IDs. It validates dispute/charge identity, environment, currency, amount relationship and PaymentIntent association. Dispute reads use only the customer access token. It does not accept a browser account override, use the developer key for customer data, or issue a Stripe write.
- `aws/provider-evidence.ts` stores a private trusted payment association in `provider-case#<caseId>`. Browser-edited case fields cannot control database queries. A saved `provider-mapping#supabase` binds the mapping to the selected Supabase project/scope version and Stripe account/environment.
- `aws/supabase-evidence-api.ts` validates simple identifiers against both approved columns and current schema. Queries are fixed SELECTs against the selected project's `public` schema through Supabase's read-only Management API. Values are bound parameters. No arbitrary SQL, project, payment reference or record content is accepted from the browser.
- A payment must identify exactly one root order. The root ID must also be unique across its table before related records are fetched. Related rows are filtered by that verified ID, and returned links are checked again. No cross-table discovery or broad background scan is implemented.
- Limits are eight scalar fields per table, three related tables, five displayed rows per related table, and 1,000 characters per string field. The sixth row signals truncation. Missing and truncated results carry explicit limitations. Known credential, QR-payload, barcode and payment-security field names are rejected even if approved. User approval still matters because field names cannot identify every sensitive value.
- `provider-evidence-preview#<caseId>` contains a server-owned snapshot, random preview ID, case/mapping/connection versions and `ttlEpochSeconds`. Code enforces expiry; DynamoDB TTL deletion is asynchronous. Case edits, scope changes, mapping changes and disconnects invalidate the preview. Transaction version checks prevent in-flight provider reads from publishing after disconnect.
- Imported records include source project/table, selected fields, content-derived identity and limitations. The snapshot timestamp is explicitly the fetch time, not delivery or attendance time. Changed snapshots can be imported as new evidence; exact duplicates on the same case are rejected. Import increments the case source revision and clears any prior draft approval.
- Supabase's OAuth permission is broader than these application controls. It is not a database-enforced per-case credential. Separate HTTP queries are not a single database snapshot transaction, so business records can change during a preview. Imported evidence should be reviewed as a bounded observation, not a complete account of an order's history.

All customer credentials stay in private existing DynamoDB token records. Preview data and payment links are excluded from general workspace responses. Imported evidence is intentionally visible on its case. Neither provider authorization nor this import flow grants refunds, Stripe dispute submission, or outbound messaging.

## Verification

Synthetic backend tests cover authorization, immutable server payment links, exact-preview import, duplicates, closed/cross-workspace cases, connection races, scope/schema changes, expiry, query injection, ambiguous orders, nonunique order IDs, unrelated children, response limits and approval invalidation. Browser tests cover dispute selection, approved-column mapping, related tables, preview-before-import, inert record text, stale preview feedback and mobile layout.

Real Supabase customer-row verification requires the customer to select a project and approve/map its tables in the app. This implementation does not choose a project, guess a mapping, or automatically import a real dispute. Current hosted verification results are recorded in [the handoff](HANDOFF.md).
