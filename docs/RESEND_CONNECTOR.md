# Resend evidence connector

## Handoff status, updated November 8, 2026

- Branch: `codex/eric-resend-evidence`, based on `codex/aiden-aws-harness` at `5e5da74`.
- Dedicated API key created, stored in Secrets Manager, and successfully verified against both sending domains.
- AWS stack and Lambda code deployed successfully. Receiver URL: `https://iutoe2cj4htkfsokxobt36iyr40rmfyh.lambda-url.us-east-1.on.aws/`.
- **Pending:** finish registering that URL in the Resend Webhooks dashboard and save its generated `webhookSecret` alongside the existing `apiKey`. The prepared browser form was interrupted before registration. The receiver intentionally returns 503 until its signing secret is configured. Live webhook delivery has not been tested yet.
- Frontend controls are deployed on the shared dev website with the integrated `codex/aiden-aws-harness` branch (Worker `569fb256-cde1-4273-b26e-dabc4f2bf930`). The AWS receiver was recreated while restoring the merged configuration; use the current URL above, not the earlier receiver URL. Live domain-read verification passed again, and an unsigned webhook returned 503 with no signing secret configured.
- Typecheck, 35 focused tests, frontend build, and AWS bundle build passed. No email was sent and no dispute was submitted.

```sh
git fetch origin
git switch --track origin/codex/eric-resend-evidence
npm ci
npm run deploy:dev
```

This connector reads existing sent-email metadata and captures signed delivery events. It has no email-send, resend, delete, or broadcast action. It does not connect a mailbox or prove attendance. Resend currently offers Full access or Sending access keys; the approved Full access credential is held only in AWS Secrets Manager. Runtime requests are restricted to GET `/domains`, GET `/emails/{uuid}`, and bounded GET `/emails?limit=100&after={uuid}` metadata pagination.

## Development configuration

- Team: `eshteremberg` in Resend.
- Dedicated key name: `causality-evidence-dev`.
- AWS account: `156129572861`, region `us-east-1`.
- Secret: `causality/dev/integrations/resend` (JSON fields `apiKey`, `webhookSecret`). Never put values in Git, browser forms in Causality, or chat.
- Environment: `RESEND_SECRET_ARN`, `RESEND_WORKSPACE_ID`, `RESEND_ALLOWED_DOMAINS` on the private backend and dedicated webhook function.
- Approved domains: `send.atmsphr.club`, `send.broeseevents.com`.
- The key is bound to the existing shared development workspace. This is not production multi-tenant onboarding. Changing the workspace or domains requires a separate reviewed configuration change.

`npm run deploy:aws` preserves existing Resend stack parameters unless explicit overrides are supplied. The receiver is a separate Lambda Function URL, exported as `ResendWebhookUrl` by the existing stack. The public handler exposes only POST `/`, verifies the raw body's Svix signature and five-minute attempt timestamp, and rejects all reads. Its role can read the one approved secret and write records only to the configured workspace partition. It cannot read email/event records or invoke the private workspace API. Logs do not record webhook bodies or secrets.

Register these Resend webhook events: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.failed`, `email.complained`, `email.suppressed`. Copy the generated signing secret into the same private Secrets Manager JSON without overwriting `apiKey`. No outgoing test email is needed; use Resend's webhook test UI. The endpoint returns 503 until a signing secret is present. Do not acknowledge unauthenticated events.

The receiver drops events from unrelated sender domains. It stores only the provider email ID, event type, event timestamp, receipt timestamp, and 90-day expiry, under `resend-event#`. It does not retain recipients, subjects, bodies, links, IP addresses, or attachments from webhooks. Retry IDs are deduplicated atomically. Expired records are excluded from reads while DynamoDB TTL deletion is pending. Older events cannot be recreated by enabling a webhook today.

## Importing evidence

Open Connections → Resend → Verify access → Import email evidence. Choose a real case. The app finds explicit Resend references already attached to it, including structured `message_log.provider_id` evidence. A single linked reference is retrieved automatically for preview. A live response is verified against the case; if the provider cannot return it, the app can display evidence already attached under that exact Resend reference, explicitly labeled as not reverified. If no reference exists, it scans one page of sent-email metadata, filters to the exact case recipient and approved sender domains, and offers candidate previews. **Search older Resend emails** advances one page at a time. The manual UUID input is an Advanced fallback. Preview before attaching.

The private API `/api/providers/resend` supports:

- GET: public configuration/verification status, never credentials.
- POST `{ "action": "verify" }`: read configured domain metadata and save an audit event.
- POST `{ "action": "find", "caseId": "..." }`: resolve case-linked Resend IDs first, otherwise search up to 100 sent-email metadata records. Optional `recent: true` bypasses existing references; `after` advances a validated UUID cursor. Only matching recipient/sender summaries leave the backend. No bodies are downloaded by listing.
- POST `{ "action": "preview", "caseId": "...", "emailId": "..." }`: retrieve one message and its captured events.
- POST `{ "action": "import", "caseId": "...", "emailId": "...", "confirmed": true }`: attach the previewed source, or refresh it if its status changed.

All actions require the authenticated, explicitly bound workspace. The case must belong to that workspace and remain editable. Sample cases cannot receive live evidence. The email UUID, approved sender domain, single recipient, and exact order reference must match the case. The order reference must occur in the source subject/text/HTML or an `order_id`, `order_ref`, or `order_number` tag. An email address match alone is insufficient. If historical messages lack a matchable order reference, the automatic importer refuses them; inspect and attach a carefully scoped original manually instead of weakening the check.

The standard preview/import path persists minimal metadata and status facts, using message bodies transiently for order matching. The separate original-evidence collector below retains case-matched provider bodies for visual PDF exhibits. Re-importing unchanged evidence is idempotent. Updating evidence increments the case revision and clears prior draft approval. Run a new investigation afterward. Captured future webhook events are included on refresh; they never silently rewrite approved or submitted evidence.

## Automatic original email capture

Before an AWS investigation begins, `aws/original-evidence.ts` resolves explicit Resend references already attached to the case and retrieves up to three pending messages. The same flow is available through Report's **Collect original emails** button and authenticated `POST /api/evidence/capture-originals` with `{ "caseId": "..." }`. Its result reports captures, previously saved originals, unavailable messages and remaining pending references. It does not require a manually entered UUID or list unrelated mail. Use case-driven discovery/import first when no source reference is attached.

All existing recipient, sender, exact-order and workspace checks apply. Successful collection writes a timestamped provider-fields snapshot containing the original HTML/text to private encrypted S3, with its SHA-256 stored on the evidence record. The case revision, evidence and audit event are committed together with version guards; approved drafts become stale. If the provider cannot return an original, no new evidence or fabricated image is added. An S3 object written before a conflicting case edit remains private and unreferenced.

The PDF renders the retained body, labels it as provider content rather than a dashboard screenshot, and embeds the retained snapshot as an original file attachment. Remote images and active content are blocked. Delivery/read/attendance qualifications still apply. See [EVIDENCE_PACKET.md](EVIDENCE_PACKET.md) for rendering limits and source-integrity checks.

`sent` is provider acceptance; `delivered` is recipient mail-server acceptance. Neither proves inbox placement, reading, cardholder authorization, or attendance. Preserve bounced/failed/complained events as counterevidence. Missing historical events remain unknown. Do not replace purchase-time policies with current terms.

## Validation and rollout

```sh
npm ci
npm run install:connectors
npm run typecheck
npx vitest run --config vitest.config.ts tests/aws-resend.test.ts tests/aws-providers.test.ts tests/aws-bridge.test.ts
npm run build
npm run build:aws
```

The browser-based Resend setup and AWS backend deployment are separate from the Cloudflare UI release. The shared site uses the account in `wrangler.dev.jsonc`; do not switch it to a personal Cloudflare account to get around missing access. Deploy the frontend using the team account's authorized session with `npm run deploy:dev`. The private AWS routes are already callable through the site's existing authenticated API bridge once the backend is deployed.

Rollback: remove/disable the dedicated webhook in Resend, revoke the dedicated API key, and clear the Resend environment/stack parameters if retiring the integration. Do not revoke other applications' existing Resend keys. Previously imported evidence remains part of its case until handled through the normal retention process.

## Case-driven search limitations

Case references are discovery hints, not trusted proof. Preview/import still re-read the exact Resend record and require configured sender, single exact recipient and exact order matching. Arbitrary UUIDs in case text are not treated as Resend IDs. A manually attached `Resend <uuid>` reference is supported, as are reviewed structured provider IDs. This does not query an unapproved Supabase message-log table in the background. Import scoped linked records first when their IDs are not yet on the case, or use paginated recipient discovery. Resend's [sent-email list API](https://resend.com/docs/api-reference/emails/list-emails) supplies metadata and pagination; the app does not invent a server-side recipient filter. A page with no matches is not proof of non-delivery or a complete history.

The **Get evidence** panel invokes this same case-driven lookup alongside Stripe, Supabase and IMAP, preserving independent errors and review requirements. It automatically previews a sole case-linked Resend record but never attaches it without the individual review/import flow.

## Saved evidence when the live record is unavailable

The `preview` and `import` paths recognize already-attached case evidence explicitly referencing the requested Resend UUID. On a provider 404 or temporary 502/503, `preview` returns `savedEvidence: true`, `liveVerified: false`, the original evidence IDs, an availability notice and a bounded excerpt. Both the Resend card and Get evidence show **Saved case evidence, not reverified**. Already-attached records have no new Attach button. An `import` request on this fallback is an unchanged no-op, never a duplicate or downgrade. Case and evidence version checks reject in-flight edits or deletions before returning the fallback. Missing provider data alone does not establish retention expiry, non-delivery, or that an email was never sent.

This preview does not reconstruct an absent body or certify manual captures. It preserves original source labels/content and conflicting saved records, includes at most 20 referenced records and 60,000 content characters total (20,000 per record), and reports excerpt truncation. The full originals remain on the case. A wrong live recipient, sender, order or malformed live response remains an error; these are not hidden by the fallback. With no matching saved evidence, provider errors remain visible.

`aws/resend-history.ts` and the merchant-log compiler context were selectively adapted from Eric's `5fffd36` retained-history work. Structured, reviewed, order-bound Supabase message logs retain merchant status limitations; merchant `delivered` is not promoted to provider-confirmed delivery, and failed/bounced counterevidence is preserved. Manual historical captures, including the reported case, are shown as previously attached evidence without inventing structured provenance. The rest of Eric's branch, including later Stripe-write work, is not merged by this change.

For an authorized case with an unavailable live reference and saved evidence, run `CAUSALITY_SMOKE_CASE_ID=<case-id> CAUSALITY_EXPECT_SAVED_RESEND=1 node scripts/smoke-customer-evidence.mjs`. It verifies the hosted fallback and combined collector, confirms no Attach action is offered, and checks the case/report remain unchanged. It never imports or sends email.
