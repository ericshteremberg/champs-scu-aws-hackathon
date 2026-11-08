# Causality

A desktop chargeback investigation workspace, built from the Causality Paper design. The landing page pairs the Enterprise product story with rounded surfaces, a subtle Paper shader, and a receipt-filled wordmark footer.

## What works

- Managed ChatGPT sign-in and sign-out, protected server routes, and one persistent workspace per signed-in owner.
- Business onboarding, an overview dashboard, searchable dispute queue, case details, evidence library, connections, access/activity, and settings.
- Manual cases and explicitly loaded synthetic sample cases; samples cannot be submitted to Stripe.
- Source records and private PDF, image, text, CSV, JSON, and email-file uploads. D1 stores records; R2 stores original attachments.
- Source-linked timelines, basic rule-based contradiction flags, editable evidence-template drafts, revision-bound approval, and export.
- Evidence changes clear approval. Submitted cases are locked. An audit trail records workspace actions.
- Versioned company policies, retention preferences, and access-request recording. Policy uploads do not grant permissions.
- Stripe server integration code for account validation, paginated dispute imports, signed webhooks, disconnect, and separately enabled merchant-approved text submission.

## Current boundaries

Stripe is deliberately **disconnected**. No credentials, account connection, real dispute imports, payments, or submissions were made. Black Label Creators LLC is reserved for a later connection decision.

This is a functional first application, with explicit integration boundaries:

- Drafts use an evidence template and limited pattern matching. No LLM is connected. PDF and image contents are not extracted automatically; originals remain available for merchant review.
- Gmail OAuth and automated company-database retrieval are not implemented. Selected emails and approved records can be imported manually. The separate database-access backend is not replaced by this application.
- Each workspace currently has one owner. Requests cannot be self-approved; independent reviewer membership and the external policy-enforcement service must be integrated before broader access can be granted.
- Retention is a saved preference; there is no scheduled deletion process yet.
- The initial Stripe connector uses a server-held restricted key tied to one workspace. It is not multi-merchant OAuth or a Stripe Marketplace App.
- Stripe submission currently sends the approved response as `uncategorized_text`. It blocks submission when supporting files are attached, rather than silently omitting them. It does not upload or map attached files into Stripe evidence categories. Complete and validate that mapping before using this for production dispute packages.
- The published Site is owner-private. Stripe cannot deliver unauthenticated webhooks through its sign-in gate. Before enabling webhooks, provide a supported service ingress or a separately hosted signature-verifying relay. Do not make workspace data public to work around this.
- Landing-page screenshots show synthetic product concepts; the access architecture is labeled as planned. The application does not claim that a bank will uphold a merchant’s dispute response.

## Run locally

Use Node 22.13 or newer.

```sh
npm ci
npm run build
```

Apply the initial migration **once** to a fresh local database:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_fluffy_hardball.sql
```

Then launch the desktop preview:

```sh
npm run dev -- --port 5173
```

Open the printed loopback URL. Local development supplies the Sites test identity through the normal **Continue with ChatGPT** link. It does not use the production account. The dev proxy strips caller-supplied identity headers. Hosted authentication is provided by Sites; it owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback`.

The build uses Vinext, React 19, TypeScript, Cloudflare Workers, Drizzle, D1, and R2. Preserve the `sites()` integration in `vite.config.ts`. Publishing through Sites applies production migrations separately from the local database.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

For API integration tests, start the **built Worker** in a second terminal:

```sh
npm start -- --port 8788
```

Then run:

```sh
CAUSALITY_API_TEST_BASEURL=http://127.0.0.1:8788 npm run test:api
```

These tests create synthetic records in local D1/R2. They exercise anonymous denial, ownership isolation, persistence, stale approvals, independent-review requirements, cross-origin rejection, upload validation, private downloads, and disconnected Stripe behavior. They only accept a localhost URL. The built preview simulates trusted platform identity with test headers; it must remain bound to loopback and must not be exposed as a public authentication service.

## Stripe configuration for later

All values remain empty or disabled in `.env.example`. Do not put a key in browser code, source control, or the hosting manifest. Set hosted runtime secrets through Sites environment settings. For local work, use an ignored `.dev.vars` file recognized by Wrangler.

| Variable | Purpose |
| --- | --- |
| `STRIPE_RESTRICTED_KEY` | Server-only `rk_test_…` restricted key; use a sandbox first. |
| `STRIPE_WORKSPACE_ID` | Exact workspace ID shown in Connections. Binds the key to one owner’s workspace. |
| `STRIPE_WEBHOOK_SECRET` | Endpoint signing secret, once webhook ingress is configured. |
| `STRIPE_ALLOW_LIVE` | Defaults to `false`; live keys are refused unless explicitly enabled. |
| `STRIPE_ENABLE_SUBMISSION` | Defaults to `false`; approval and export work without submission. |

The restricted key must permit reading the current account and disputes. Write access to disputes is only needed for a separately enabled submission path. The connection validates the account and environment; later requests must match that binding. Do not enable submission until test-mode evidence packaging and the entire review flow are verified.

Webhook processing verifies the raw body signature and timestamp, checks account/environment binding, records event IDs, and retrieves current dispute state. Submission requires a real imported Stripe case, an exact approved revision, and explicit confirmation. The same revision uses a stable idempotency key. An ambiguous submission failure remains locked for reconciliation rather than inviting a duplicate submission.

Primary references: [Stripe disputes](https://docs.stripe.com/api/disputes), [updating dispute evidence](https://docs.stripe.com/api/disputes/update), [webhooks](https://docs.stripe.com/webhooks), [restricted keys](https://docs.stripe.com/keys/restricted-api-keys), [currency units](https://docs.stripe.com/currencies).

## Source map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx`, `app/landing.css`, `components/landing/` | Landing page and motion |
| `app/login/`, `app/workspace/`, `components/workspace/` | Authentication entry and application screens |
| `app/chatgpt-auth.ts`, `lib/server/auth.ts` | Managed identity, ownership checks, origin checks, bounded request bodies |
| `lib/server/workspace.ts`, `lib/server/report.ts` | Workspace operations, evidence workflow, draft assembly |
| `app/api/evidence/`, `lib/server/uploads.ts` | Validated private file storage and downloads |
| `lib/stripe/`, `app/api/stripe/` | Disconnected-by-default Stripe integration |
| `db/schema.ts`, `drizzle/` | Persistent schema and immutable migrations |
| `tests/` | Unit and local API integration checks |
| `public/causality/` | Paper exports and licensed shader runtime |

The Sites project ID is preserved in `.openai/hosting.json`. Runtime secrets and local test records are excluded from publication source.
