# Resend evidence connector

## Handoff status — November 7, 2026

- Branch: `codex/eric-resend-evidence`, based on `codex/aiden-aws-harness` at `5e5da74`.
- Dedicated API key created, stored in Secrets Manager, and successfully verified against both sending domains.
- AWS stack and Lambda code deployed successfully. Receiver URL: `https://vnbplyjmvidsee4ioh6eycru4u0sxxtb.lambda-url.us-east-1.on.aws/`.
- **Pending:** finish registering that URL in the Resend Webhooks dashboard and save its generated `webhookSecret` alongside the existing `apiKey`. The prepared browser form was interrupted before registration. The receiver intentionally returns 503 until its signing secret is configured. Live webhook delivery has not been tested yet.
- **Pending on the teammate's computer:** deploy the frontend using the existing team Cloudflare session. The current shared website does not yet show the new Resend controls. From this branch, run `npm ci` then `npm run deploy:dev`, or merge this branch into the team's working branch before deploying. Preserve the account ID and existing hosted secrets in `wrangler.dev.jsonc`.
- Typecheck, 35 focused tests, frontend build, and AWS bundle build passed. No email was sent and no dispute was submitted.

```sh
git fetch origin
git switch --track origin/codex/eric-resend-evidence
npm ci
npm run deploy:dev
```

This connector reads existing sent-email metadata and captures signed delivery events. It has no email-send, resend, delete, or broadcast action. It does not connect a mailbox or prove attendance. Resend currently offers Full access or Sending access keys; the approved Full access credential is held only in AWS Secrets Manager. Runtime requests are restricted to GET `/domains` and GET `/emails/{uuid}`.

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

Open a real case → Investigation → Resend → Add email evidence. Verify access, paste the specific email UUID, preview its recipient/order match, and choose Attach to report. The case refreshes immediately; its next compilation includes the imported delivery source. Connections → Resend offers the same controls with a case selector. Linked records have a Check latest status action; refresh still requires preview and attach. No message is sent.

The controls distinguish connection loading, missing deployment, missing configuration, and provider errors. Live imports are disabled on sample or closed cases and while an investigation is running. Unsaved response edits must be saved before importing from the case view. Deploy matching frontend and AWS backend versions; local-only storage cannot call the live Resend connector.

The private API `/api/providers/resend` supports:

- GET: public configuration/verification status, never credentials.
- POST `{ "action": "verify" }`: read configured domain metadata and save an audit event.
- POST `{ "action": "preview", "caseId": "...", "emailId": "..." }`: retrieve one message and its captured events.
- POST `{ "action": "import", "caseId": "...", "emailId": "...", "confirmed": true }`: attach the previewed source, or refresh it if its status changed.

All actions require the authenticated, explicitly bound workspace. The case must belong to that workspace and remain editable. Sample cases cannot receive live evidence. The email UUID, approved sender domain, single recipient, and exact order reference must match the case. The order reference must occur in the source subject/text/HTML or an `order_id`, `order_ref`, or `order_number` tag. An email address match alone is insufficient. If historical messages lack a matchable order reference, the automatic importer refuses them; inspect and attach a carefully scoped original manually instead of weakening the check.

Only minimal metadata and status facts enter the report. Provider provenance assigns these records explicitly to the delivery section, and the source register labels them Resend. Normalized provider status is passed to the compiler so bounced/failed messages remain counterevidence. Message bodies are used transiently for order matching, not persisted. Re-importing unchanged evidence is idempotent. Updating evidence increments the case revision and clears prior draft approval. Run a new investigation afterward. Captured future webhook events are included on refresh; they never silently rewrite approved or submitted evidence.

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
