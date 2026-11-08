# ATMSPHR merchant evidence API

A read-only Node HTTP service implementing:

```http
GET /v1/cases/{externalCaseId}/evidence?section=summary
Authorization: Bearer <merchant-issued-credential>
```

Supports `summary`, `order`, `tickets`, `delivery`, `history`, `support`, `attendance`, and `policy` using the existing Causality wire contract. It imports the actual consumer validator; it does not change shared application files.

## Current status

Implemented and locally tested against fictional records, including real embedded PostgreSQL query execution. The source column names and relationships were inspected in the merchant's Supabase dashboard. **Not deployed or connected to production. No merchant schema/data changes were made.** No real grant, Stripe credential, customer record, or database credential is bundled. SQL tests use a minimal projection of the inspected schema, not a complete migration or a production database clone.

The adapter maintains its own pinned dependencies, TypeScript configuration and CI job. Root application type checking excludes this standalone package; run the adapter checks below separately. The root lock includes the optional `@emnapi/core` and `@emnapi/runtime` entries needed for clean installs.

## Run and test

Use Node 22.13+ (Node 24 LTS recommended) with this checkout's application dependencies available. From the repository root:

```sh
npm ci --prefix integrations/atmsphr
npm test --prefix integrations/atmsphr
npm run typecheck --prefix integrations/atmsphr
npm run test:investigation
npm run typecheck
npm start --prefix integrations/atmsphr
```

Startup fails closed without private configuration. No fixture fallback exists. `fixtures.ts` contains fictional wire-format tests that use `live` only because the current consumer requires that literal. Those examples are never loaded by the server.

Supply the following using the merchant's approved server-side secret/configuration mechanism. Do not place values in Git, chat, frontend variables, screenshots, or request URLs.

| Setting | Purpose |
| --- | --- |
| `ATMSPHR_DATABASE_URL` | Restricted PostgreSQL login, with verified TLS; no SSL override query parameters |
| `ATMSPHR_DATABASE_CA` | Optional trusted database CA PEM text |
| `ATMSPHR_GRANTS_FILE` | Absolute path to a private JSON grant file, owner-readable only (`0600`) |
| `ATMSPHR_STRIPE_READ_KEY` | Restricted ATMSPHR platform key permitting dispute and charge reads |
| `ATMSPHR_STRIPE_LEGACY_READ_KEY` | Optional corresponding restricted key for native legacy-platform orders |
| `HOST` | Defaults to `127.0.0.1`; explicitly configure the deployment interface |
| `PORT` | Defaults to `8788` |

The Stripe key's test/live prefix must match the grant. Every Stripe GET uses the grant's explicit `Stripe-Account` context. This supports platform-owned charges and Connect accounts when the configured restricted key can read that account. A host's payout account is never used to infer the account that processed a charge.

Use an HTTPS reverse proxy/merchant hosting runtime in production. Do not expose plain HTTP publicly. Keep the exact route and configure Causality's base URL without `/v1/cases`. The server does not enable browser CORS. Upstream reads reject redirects; a 14-second outer deadline fits the consumer's 15-second limit. Database reads use repeatable-read, read-only transactions, statement timeouts, a bounded connection pool, selected columns, and parameterized merchant/order/payment predicates.

## Private grant format

The file is an array of `{ "digest": "<SHA-256 hex digest of bearer>", "grant": { ... } }`. Store only the digest, not the bearer. Use an operator-issued high-entropy bearer (at least 32 URL-safe characters) and transfer it privately through the approved credential channel. This service does not generate, display, or distribute credentials.

Each grant contains:

- `caseId`: alphanumeric first character, then letters/digits/underscores/hyphens, maximum 160 characters.
- `merchantId`, `orderId`: approved organizer and order UUIDs.
- `orderRef`: exact `orders.order_number`.
- `paymentRef`: exact Stripe PaymentIntent reference in `orders.payment_ref`.
- `disputeId`: approved Stripe dispute ID.
- `stripeAccountId`: actual charge/dispute account, not the host transfer destination.
- `stripePlatform`: `legacy` or `atmsphr`.
- `livemode`: expected Stripe mode.
- `expiresAt`: ISO timestamp with timezone; `revoked`: boolean.
- `customerLabel`: approved pseudonymous label; `claim`: approved claim text. Neither is inferred from an email address. Summary evidence identifies these as grant-supplied fields.

No example credential or grant is active by default. The entire file is validated on each lookup, limited to 1 MB/1,000 entries, and duplicate digests fail closed. Replace it atomically to update grants. Removal/revocation is checked at request entry and immediately before serving the response. Case grants cannot be expanded by query parameters. There is no grant-management HTTP endpoint.

## Source mapping

| Section | Selected sources | Limits and interpretation |
| --- | --- | --- |
| summary | Approved grant + `orders → events → organizers`, `atmsphr_stripe_objects`, live Stripe dispute → charge → PaymentIntent | Verify organizer, order number, payment reference, platform, account, live/test mode and charged amount before setting `mapping_verified`. Dispute amount, reason, opening and due dates come from Stripe. |
| order | `orders`, `order_items` | One order and at most 12 lines, with minor-unit totals, status, channel and line quantities/prices. |
| tickets | `tickets` constrained by order and event | At most 25 tickets; state, tier, face value, scan timestamp, transfer references. No attendee contacts or QR secrets. |
| delivery | `order_email_queue` | State, attempts and first-attempt/queue timestamp. `accepted` means provider acceptance, not delivery/read. No raw payload or freeform detail. |
| attendance | `scans → tickets → order` and matching event | At most 20 scan results. Wrong-event/rejected scans are not treated as admission. No scans does not establish nonattendance. |
| history | `refunds` constrained by order | At most 10 refund rows; settlement is not independently verified. No customer-wide history. Ticket transfer references remain in the tickets section. |
| policy | Order `terms_version`, `age_ack` | Partial: no immutable historical policy text or proof of presentation is asserted. |
| support | No configured corroborated thread | Unavailable: organizer messages have no order foreign key. |

Each evidence ID is derived from case, section, and a stable source reference; `source_id` retains the source table/record or Stripe object reference. Missing sources return `unavailable` with empty records and an explanation. Bounded subsets return `partial`. Cross-section IDs are validated globally; aggregate evidence is below the 90-record cap, with 1 MB response/context and conservative per-record bounds.

### Explicit exclusions

This first endpoint handles native, paid Stripe ticket orders only. It rejects imported fee orders (`atmsphr_legacy_fee_orders`), membership redemptions/bundles, and non-Stripe orders. The current merchant repository/runtime is still needed to integrate this code into that application's own deployment flow if a standalone service is unsuitable.

`broese` imported orders, payments without issued orders, external door payments, guest-list admissions, and membership disputes need separate mapping adapters. The existing `app.owner_payment_sources` view identifies those distinctions, but is not used to silently coerce them into ticket orders. A selected approved case outside this scope is unavailable (404).

SMS data is excluded until an order-to-provider delivery key is corroborated; matching on phone/profile alone is insufficient. Broad reporting adjustments, balance snapshots, arbitrary message payloads, QR/redemption material, staff/device identifiers, and database internals are not returned.

## Database access

`read-role.sql` is a **reviewable provisioning proposal**, not an applied migration. It defines a role with column-scoped reads on the tables referenced by the queries. A merchant administrator must bind an appropriate existing login and review RLS policies; the role does not create credentials, bypass RLS, or impose row policies. The API's bound queries enforce case selection before rows are retrieved. Do not substitute a Supabase service-role key or database-owner login.

## Deployment handoff and remaining live verification

Before deployment, the merchant operator must provide the restricted database connection, verified Stripe routing/read key, and one privately approved grant. No production case was selected during schema inspection.

Then:

1. Deploy this service in merchant-controlled hosting behind HTTPS, with the private grant mounted securely.
2. Confirm a real approved case returns a summary, and that changing its case ID is denied; verify expiry and revocation against that deployment.
3. Check delivery/source limitations and saved source IDs using the approved case, without publishing private records.
4. Give Aiden the HTTPS base URL, external case ID, commit, and test results. Transfer the bearer privately. Aiden owns configuration of both Causality runtime functions and the final import/investigation rehearsal.

No Stripe submissions, refunds, messaging, remote database writes, or shared deployment changes are implemented.

Reference behavior: [parameterized PostgreSQL queries](https://node-postgres.com/features/queries), [Stripe dispute retrieval](https://docs.stripe.com/api/disputes/retrieve), [Stripe charge retrieval](https://docs.stripe.com/api/charges/retrieve), and [PGlite test API](https://pglite.dev/docs/api).
