# Customer account connections

Eric's final registration artifacts were integrated from `codex/eric-oauth-setup`, commit `22332a65f1d8f16c8c17e6b834ecc73e7c9f6037`. The Supabase app belongs to Glowchat; the Stripe app belongs to Black Label Creators LLC. Developer secrets remain in AWS Secrets Manager, `causality/dev/oauth/supabase` and `causality/dev/oauth/stripe`, in `us-east-1`. Exact nonsecret ARNs and callbacks are under `integrations/oauth/`. The private Stripe external-test link is stored only in its secret's `authorizeUrl` field.

## What a customer can do

On Connections, click **Connect Supabase**, sign in and authorize at Supabase, then return to Causality. Choose a project from the authorized account. Review the selected project's public-schema table and column names, choose an evidence scope, and save it. Disconnect disables further reads in Causality and attempts provider-side revocation. A failed revocation remains visible and can be retried.

The developer app registration is shared by customers. Customers do not register their own app, send an API key, provide a database password, or install an endpoint for this flow. The current hosted preview still uses a shared team Basic login, not production multi-user authentication.

Click **Connect Stripe** to install Causality's read-only external test app on the intended customer account. The return screen shows its account ID and environment. **Verify read access** reads at most one dispute and, if available, its linked charge; it saves only verification metadata, not record contents. An empty dispute list verifies dispute access but does not prove charge access. The app cannot refund or submit evidence through these read-only grants. Stripe's test app is not Marketplace reviewed or publicly published.

Stripe disconnect deletes Causality's saved tokens and stops its reads. It does not uninstall the app at Stripe. The UI links to Stripe Installed Apps and explains that uninstalling Causality there revokes the provider grant. If a callback fails after installation, or Stripe reports the app is already installed during reconnection, uninstall it before trying again. The Stripe Apps documentation does not establish that the separate Connect deauthorization API is appropriate here, so this implementation does not call it.

Only project and schema metadata are read from Supabase. Saving a table/column scope is not a completed semantic mapping or live evidence import. Verified dispute/payment/order linking and OAuth-backed evidence retrieval remain to be built. The existing merchant-hosted endpoint workflow remains independently available.

## Stripe runtime

- `aws/stripe-oauth-api.ts` loads the exact developer secret and validates its callback, developer-key environment and Marketplace OAuth host/path/client ID. The stored external-test path is preserved; the backend adds a fresh state and registered callback. The private invite URL is returned only to the authenticated browser starting authorization, never in public status, logs or committed files.
- Only code exchange and token refresh use the standard developer key, at `https://api.stripe.com/v1/oauth/token`. Dispute/charge reads use the customer access token, never the developer key, a legacy restricted key or a caller-supplied `Stripe-Account` override. Responses are bounded to 256 KiB with an 8-second network deadline. Provider bodies and exceptions are sanitized.
- `aws/stripe-provider.ts` stores public account/mode metadata in `provider#stripe`, private tokens in `provider-token#stripe`, and the pending flow in `provider-oauth#stripe`. These use the existing workspace partition and DynamoDB encryption at rest. Public projections exclude credentials, test URLs and raw provider records.
- State is random, hashed in storage, single use, expires after 10 minutes, and is bound to user/workspace/connection version plus a Secure, HttpOnly, SameSite=Lax `__Host-causality-stripe` cookie. Stripe and Supabase use independent cookies and state keys. Stripe Apps documents state protection but not PKCE for this flow; Supabase retains S256 PKCE.
- Token responses must identify a Stripe account, the configured live/test mode and `stripe_apps` scope. Refresh must retain the same account and mode. Access tokens use Stripe's documented one-hour lifetime when `expires_in` is absent. A conditional refresh lock prevents simultaneous refresh-token reuse; ambiguous failures require reconnection. A crashed refresh requires disconnect/reconnect.
- Every read result and token update checks connection/token versions before publication. A disconnect during code exchange, refresh or verification cannot republish credentials or results. Credentials from a lost race are discarded locally; the Stripe installation still needs manual uninstall to revoke its grant. No promise of automatic provider-side revocation is made.
- The existing operator-key `/api/stripe/*` paths remain separate. OAuth grants do not enable their submission path, and no customer tokens are written to legacy environment settings. No webhooks, automatic dispute import, refunds or evidence submission were added.

## Runtime and data boundaries

- `aws/supabase-api.ts` loads the developer app credential from Secrets Manager. It rejects unexpected callback or scope configuration and calls only fixed Supabase API endpoints. Responses have an 8-second network deadline and a 256 KiB body limit. Provider error bodies and tokens are not logged or forwarded to the browser.
- `aws/providers.ts` owns authorization, refresh, project selection, scope approval and disconnect. All records are partitioned by the authenticated workspace. `provider#supabase` is public metadata, `provider-token#supabase` is private token storage, and `provider-oauth#supabase` holds the one pending authorization attempt per workspace.
- DynamoDB server-side encryption protects stored tokens and PKCE verifiers at rest. This is not application-level encryption. Tokens never appear in workspace state, public status, URLs, audit details or browser storage. Secrets Manager stores the developer app credential, not each customer token.
- OAuth state expires after 10 minutes and is atomically consumed before code exchange. State is bound to the workspace, user, connection version and a random browser cookie. The bridge issues that cookie as `__Host-causality-supabase`, Secure, HttpOnly, SameSite=Lax. Supabase uses S256 PKCE. An old callback, another browser, a replaced flow or a disconnect cannot publish a new authorization.
- Refresh takes a conditional DynamoDB lock before contacting Supabase, preventing concurrent reuse of a rotating refresh token. Ambiguous refresh failures require reconnection instead of blind retries. A process crash while refreshing can leave a locked token; disconnect and authorize again. In-flight responses must pass connection/token version checks before returning or saving data.
- Disconnect clears the project/scope and invalidates pending state before revocation. Failed revocations retain a private token solely for retry; the disconnected status blocks its use for reads and new authorizations. If the provider remains unavailable, remove Causality in the Supabase organization's Authorized apps. A token produced during a disconnect race is revoked on a best-effort basis and never republished locally.
- Project selection is validated against the projects returned by the authorized account. Its organization is taken from that response, not supplied by the browser. Changing projects clears scope approval.
- Schema discovery uses a fixed parameterized query against `information_schema.columns`, restricted to `public`, via `/v1/projects/{ref}/database/query/read-only`. It reads no customer rows and accepts no caller SQL. There is a 1,000-column limit; only simple SQL identifiers are supported. Approval rechecks the schema, rejects unknown/duplicate fields and saves at most 30 tables with 100 columns each.
- Supabase's `database:read` OAuth scope permits broader reads than the selected evidence scope. The app must enforce row and field restrictions when evidence queries are added. OAuth permission itself is not case-scoped. The read-only query and revocation endpoints are beta provider APIs.

## Routes and infrastructure

| Route | Contract |
| --- | --- |
| `GET /api/providers` | Public configuration/connection status; no tokens |
| `POST /api/providers/supabase/start` | Same-origin authenticated start; returns `authorizationUrl` and sets the browser binding cookie |
| `GET /api/providers/supabase/callback` | Authenticated callback, validates state/cookie and redirects to Connections with a fixed result code |
| `POST /api/providers/supabase` | `projects`, `select_project`, `schema`, `approve_tables`, or `disconnect` |
| `POST /api/providers/stripe/start` | Same-origin authenticated start using the private test link and Stripe browser cookie |
| `GET /api/providers/stripe/callback` | Authenticated, single-use state validation; server-side token exchange and fixed result redirect |
| `POST /api/providers/stripe` | Explicit `verify` read check or local `disconnect` |

The Worker continues to authenticate and proxy to private Lambda. The callback does not bypass team login. Provider routes use `Referrer-Policy: no-referrer`; hosted Worker invocation logging is disabled to avoid retaining callback query strings. Application error logging stays limited to event/error type, with no request body or URL.

The CloudFormation parameters `SupabaseOAuthSecretArn` and `StripeOAuthSecretArn` provide backend configuration and exact-resource `secretsmanager:GetSecretValue` grants. The two existing Lambdas share a role, so both inherit these grants; only the API Lambda receives OAuth configuration. The deployment script defaults to Eric's registered ARNs. A different deployment must supply its own `SUPABASE_OAUTH_SECRET_ARN`, `STRIPE_OAUTH_SECRET_ARN` and matching frontend origin. DynamoDB TTL is enabled on `ttlEpochSeconds`; expiry is checked in code because deletion is asynchronous.

`@aws-sdk/client-secrets-manager` is the only new application dependency. Developer credentials are never copied into the Worker or committed environment files. The existing temporary workshop session still powers the Worker-to-Lambda bridge and needs refreshing when it expires.

## Verification and next customer test

Deployed November 7, 2026: AWS stack `causality-hackathon-dev` reached `UPDATE_COMPLETE`, both Lambda bundles were uploaded, and the frontend Worker version is `1723ecb2-11fe-47be-933a-0f32386d392c`. Build/type checks, 462 unit/integration tests, 26 browser checks, targeted lint, CloudFormation validation and Wrangler dry run passed. The five provider browser tests passed again after adding mobile wrapping for Stripe account IDs.

The hosted Stripe start/cancel smoke passed: authenticated AWS status, cross-origin start rejection, real developer-secret loading, secure browser cookie, denied callback, state replay rejection and disconnected-read denial. It intercepted the private Stripe consent navigation and did not install the app or exchange a customer code. Supabase's start/cancel smoke passed at the prior deployment; its repeat was stopped because the shared workspace now has an authorized customer connection. A subsequent real Supabase project-list request succeeded (HTTP 200, two projects), with no project selected by the test and no customer database rows queried. Successful Supabase authorization is therefore observed in saved runtime state and its credential has passed a real read. Stripe customer installation, successful Stripe code exchange/refresh and Stripe customer reads remain untested.

Results and screenshots are in ignored `.aws-build/`. The smoke script skips an established customer authorization or pending revocation, and sanitizes failure output so invitation URLs, state and tokens cannot enter terminal logs. Do not run a start/cancel smoke while a teammate has an authorization in progress in the shared workspace.

Unit tests cover callback replay/expiry/browser/workspace binding, denial, PKCE, token privacy, project authorization, scope validation, concurrent refresh, disconnect races and revocation retry. Network tests check the official exchange/revoke request contracts, fixed read-only metadata query, response limits and sanitized errors. Browser tests cover the Connect redirect, project and field selection, disconnect, canceled consent and mobile layout using mocked provider responses.

After deployment, run `node scripts/smoke-provider-oauth.mjs stripe` and `node scripts/smoke-provider-oauth.mjs supabase` only for disconnected providers to verify hosted start and denied-callback paths without granting customer access. These checks alone do not prove successful customer consent, token exchange, refresh or provider reads against a real account. Keep those results separate from the actual Supabase project-list read recorded above. Real token refresh, Supabase schema reads and successful Stripe customer authorization still need customer testing.

Eric's customer test: open Connections, authorize the intended Stripe account, confirm its displayed ID/mode and click Verify read access. Authorize Supabase, choose the intended project and review its table/column scope. Report errors without copying codes, tokens or private invitation URLs. Once both connections are verified, implement provider-specific dispute import and validate each order/payment/merchant relationship before enabling live evidence queries. Keep refund actions and Stripe evidence submission disabled throughout the connector test.

References: [Supabase OAuth guide](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration), [read-only query](https://supabase.com/docs/reference/api/v1-read-only-query), [Management API OpenAPI contract](https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json), [Stripe Apps OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth), [Stripe external testing and uninstall](https://docs.stripe.com/stripe-apps/test-app).
