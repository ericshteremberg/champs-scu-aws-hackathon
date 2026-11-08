# Customer account connections

Eric's registration artifacts were integrated from `codex/eric-oauth-setup`, commit `203ab8122354e4bea5590298728d90fa21a6bef4`. The Supabase app belongs to Glowchat. Its developer secret remains in AWS Secrets Manager, `causality/dev/oauth/supabase`, in `us-east-1`. The exact nonsecret ARN and callback are in `integrations/oauth/supabase-registration.json`.

## What a customer can do

On Connections, click **Connect Supabase**, sign in and authorize at Supabase, then return to Causality. Choose a project from the authorized account. Review the selected project's public-schema table and column names, choose an evidence scope, and save it. Disconnect disables further reads in Causality and attempts provider-side revocation. A failed revocation remains visible and can be retried.

The developer app registration is shared by customers. Customers do not register their own app, send an API key, provide a database password, or install an endpoint for this flow. The current hosted preview still uses a shared team Basic login, not production multi-user authentication.

Only project and schema metadata are read by this implementation. Saving a table/column scope is not a completed semantic mapping or a live evidence import. Stripe OAuth registration is still blocked by its CLI plugin HTTP 403, as recorded in `docs/handoffs/05-eric-oauth-results.md`. Its Connect button remains disabled. Verified dispute/payment/order linking and OAuth-backed evidence retrieval remain to be built after registration. The existing merchant-hosted endpoint workflow remains independently available.

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

The Worker continues to authenticate and proxy to private Lambda. The callback does not bypass team login. Provider routes use `Referrer-Policy: no-referrer`; hosted Worker invocation logging is disabled to avoid retaining callback query strings. Application error logging stays limited to event/error type, with no request body or URL.

The CloudFormation parameter `SupabaseOAuthSecretArn` provides the backend configuration and an exact-resource `secretsmanager:GetSecretValue` grant. The two existing Lambdas share a role, so both inherit this grant; only the API Lambda receives the OAuth configuration. The deployment script defaults to Eric's registered ARN. A different deployment must supply its own `SUPABASE_OAUTH_SECRET_ARN` and matching frontend origin. DynamoDB TTL is enabled on `ttlEpochSeconds`; expiry is checked in code because deletion is asynchronous.

`@aws-sdk/client-secrets-manager` is the only new application dependency. Developer credentials are never copied into the Worker or committed environment files. The existing temporary workshop session still powers the Worker-to-Lambda bridge and needs refreshing when it expires.

## Verification and next customer test

Deployed November 7, 2026: AWS stack `causality-hackathon-dev` reached `UPDATE_COMPLETE`, both Lambda bundles were uploaded, and the frontend Worker version is `5f31b8cc-260e-4f50-9d4e-e7cff8e46b2c`. The build/type checks, 443 unit/integration tests, 24 browser checks, targeted lint, CloudFormation validation and Wrangler dry run passed. An initial local browser run used stale assets while rebuilding; restarting the preview fixed the asset errors. One new test locator was corrected to use the project combobox's accessible role, then all three provider browser tests passed.

`node scripts/smoke-provider-oauth.mjs` passed against the hosted app: authenticated AWS status, cross-origin start rejection, real developer-secret loading, secure browser cookie, denied callback, state replay rejection and disconnected-read denial. It intercepted navigation to Supabase's consent page and did not authorize a real account or exchange a code. Results and screenshots are in ignored `.aws-build/`. Do not run this start/cancel check while a teammate is authorizing in the shared workspace or after a customer connection has been established.

Unit tests cover callback replay/expiry/browser/workspace binding, denial, PKCE, token privacy, project authorization, scope validation, concurrent refresh, disconnect races and revocation retry. Network tests check the official exchange/revoke request contracts, fixed read-only metadata query, response limits and sanitized errors. Browser tests cover the Connect redirect, project and field selection, disconnect, canceled consent and mobile layout using mocked provider responses.

After deployment, verify the hosted start and denied-callback path without granting customer access. This checks the real app secret load, Lambda route, cookie/state persistence, redirect and replay rejection, but does not prove successful customer consent, token exchange, refresh, project listing or schema querying against a real account. Eric's first in-app authorization must verify those remaining provider interactions. Do not mark them tested based on registration, a mocked suite or a start/cancel smoke check.

No real customer disputes or database rows are needed for this phase. After Stripe registration, implement provider-specific dispute import and validate each order/payment/merchant relationship before enabling live evidence queries. Keep refund actions and Stripe evidence submission disabled throughout the connector test.

References: [Supabase OAuth guide](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration), [read-only query](https://supabase.com/docs/reference/api/v1-read-only-query), [Management API OpenAPI contract](https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json).
