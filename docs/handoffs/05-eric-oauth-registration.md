# Eric: register Causality's provider integrations, then hand back to Aiden

## Objective and boundary

Aiden cannot complete provider sign-in on his computer. Eric will sign in on his computer, and his coding agent will finish the one-time **Causality developer application setup**. Then Aiden will finish the customer connector implementation. GitHub carries the work between computers; the current chat does not automatically move to Eric's computer.

Eric is helping as a developer in this step. Later, as a customer, he should open Causality, click Connect Stripe and Connect Supabase, authorize access, choose his project, review the evidence mapping, and select a dispute. That future customer flow must not require him to create an endpoint, provide database passwords, or paste API keys into Causality.

The same Causality developer apps serve other businesses; this registration is not repeated for every customer. Each business signs into the provider after clicking Connect, unless already signed in, and approves its own account access. Store customer tokens separately and bind them to the correct workspace. Stripe has a common API schema, but each business's Supabase schema can differ, so guided mapping and supported-schema validation remain necessary. Do not promise arbitrary databases will work automatically. Stripe external testing is an initial test channel, not unrestricted public distribution.

The existing deployment supports guided mapping and connections to merchant-hosted evidence endpoints. **Stripe Apps OAuth, Supabase OAuth, their callbacks, and automatic token refresh are not implemented yet.** Registering applications does not establish a working customer connection.

## Start on Eric's computer

Repository: <https://github.com/ericshteremberg/champs-scu-aws-hackathon>.

Use the latest `origin/codex/aiden-aws-harness` as the starting point, not the old frontend branch. Inspect the working tree, branch, upstream and fetched remote state first. Preserve Eric's existing changes. An isolated worktree is suitable:

```sh
git status --short --branch
git branch -vv
git fetch origin
git worktree add -b codex/eric-oauth-setup ../causality-oauth-setup origin/codex/aiden-aws-harness
cd ../causality-oauth-setup
```

If that branch/worktree already exists, inspect and resume it instead of overwriting it. Read `docs/HANDOFF.md`, this document, and applicable `AGENTS.md` instructions. Node 22.13 or newer is required for repository scripts.

Eric handles interactive login, MFA, account selection and any provider consent requiring a human. The agent handles the remaining configuration. Have Eric identify the Stripe account and Supabase organization that should own Causality's integrations before creating apps there. Those developer owners and the eventual ATMSPHR customer account are separate roles, even if Eric controls both.

## Registration contract

Use the name **Causality** and description: **Investigate ticket disputes using payment records and relevant order, ticket, delivery and attendance evidence.**

| Setting | Value |
| --- | --- |
| Website | `https://causality-hackathon-dev.slidah60.workers.dev` |
| Customer Connections page | `https://causality-hackathon-dev.slidah60.workers.dev/workspace?view=integrations` |
| Stripe callback | `https://causality-hackathon-dev.slidah60.workers.dev/api/providers/stripe/callback` |
| Supabase callback | `https://causality-hackathon-dev.slidah60.workers.dev/api/providers/supabase/callback` |
| Shared AWS stack | `causality-hackathon-dev` |
| AWS region | `us-east-1` |

These callback paths are the agreed implementation targets for Aiden, not currently working routes. Do not invent privacy-policy or support URLs if a provider requires them. Record the requirement and ask Eric for accurate business details. The preview has a private team login; do not remove it to satisfy registration or rotate it independently.

## 1. Stripe developer registration

Follow [Stripe Apps OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth). Create or reuse a Causality Stripe App, with `stripe_api_access_type: "oauth"`, `distribution_type: "public"`, and the exact Stripe callback above in `allowed_redirect_uris`. Preserve a reproducible app manifest and required authored assets under `integrations/stripe-app/` if new files are needed. Do not substitute the legacy environment-key connection in `aws/stripe.ts` for customer OAuth.

Request `dispute_read` and `charge_read`. Add `connected_account_read` if required for account verification. Explain each purpose in the manifest. Do not request dispute, charge, refund or file writes. Verify names against the current [permissions reference](https://docs.stripe.com/stripe-apps/reference/permissions).

Upload the app and configure [external testing](https://docs.stripe.com/stripe-apps/test-app), preferably limited to the intended tester. For ATMSPHR's live disputes, the developer app must be uploaded from a live account. Sandbox/test-only external test links cannot install on live accounts. External testing allows up to 25 testers before publication. Copy the exact Dashboard-provided OAuth external test authorization URL and record its mode; do not guess its query parameters or claim a normal public install link works before publication.

Capture the app/client identifiers and the developer credential required for server-side OAuth code exchange. Store that credential privately as described below. It is a Causality developer credential, not a customer-provided restricted API key. Do not place OAuth tokens into the legacy `STRIPE_RESTRICTED_KEY` setting.

## 2. Supabase developer registration

Follow [Supabase's OAuth integration guide](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration): organization Settings, OAuth Apps, Add application. Register the exact Supabase callback above. Configure `projects:read` and `database:read` on the app. Add another read scope only if a required endpoint demonstrably needs it, and document why. Keep the client secret private.

The planned backend uses [the read-only Management API query endpoint](https://supabase.com/docs/reference/api/v1-read-only-query), `POST /v1/projects/{ref}/database/query/read-only`, with schema-qualified, parameterized, bounded queries. This endpoint is beta and uses `database:read`. Do not replace it with the generic write-capable query endpoint to work around a failure.

OAuth database read access is broader than one case. Causality must enforce the approved tables, columns, merchant and case filters before querying. Do not describe OAuth itself as granting access only to one order. No database password, service-role key, new SQL role, schema change or RLS change is needed for this registration task.

## 3. Store application credentials for the AWS backend

Prefer AWS Secrets Manager in the same team AWS account and `us-east-1`. First verify the AWS identity and that it owns the existing `causality-hackathon-dev` stack. If Eric lacks the team workshop session, finish provider registration and report that storage is blocked; do not deploy into a different AWS account.

Proposed secret contract for Aiden's implementation:

| Secret name | JSON fields |
| --- | --- |
| `causality/dev/oauth/stripe` | `clientId`, `developerApiKey`, `authorizeUrl`, `mode` (`live` or `test`), `redirectUri` |
| `causality/dev/oauth/supabase` | `clientId`, `clientSecret`, `redirectUri`, `scopes` (array) |

Inspect metadata before creating either secret. Do not overwrite an existing integration's secret or rotate its keys without establishing that it is the intended Causality app. Use a secure input mechanism, not credentials in shell arguments, logs, screenshots, chat or Git. Return secret ARNs and region, never secret values. Verify storage using metadata and a value-free check of required field presence.

Secrets Manager access is a new proposed backend dependency. Existing Lambda code does not read these secrets yet, and its role may need permission. Record the ARNs for Aiden to wire into infrastructure with narrowly scoped read access. Do not redeploy the shared stack from this setup branch.

If workshop permissions block Secrets Manager, retain credentials only on Eric's computer in an ignored `.env.oauth.local` file with mode `0600`, confirm `git check-ignore` covers it, and report the blocker. An ignored file is a temporary local fallback, not a cross-computer handoff. Arrange a private credential transfer later if AWS storage remains unavailable. Never put secrets in `NEXT_PUBLIC_*` variables or committed registration results.

## 4. Verify and return the work

Verify that both registrations show the exact callbacks and read permissions. Check that Stripe's external test link opens the intended app and permission screen. Do not complete a customer installation against missing callbacks or label the connection tested. No real dispute import, evidence submission, refund, customer messaging, or database mutation is part of this task.

Write `docs/handoffs/05-eric-oauth-results.md` with these nonsecret results:

```text
Stripe registration: complete / blocked, with reason
Stripe app ID and client ID:
Stripe developer mode and external testing status:
Stripe permissions and registered callback:
Stripe authorization URL location: AWS secret field or private team location
Supabase registration: complete / blocked, with reason
Supabase client ID, configured scopes and registered callback:
AWS region and provider secret ARNs, or local-only storage blocker:
Registration checks actually performed:
Any provider review, ownership, billing or access requirement still outstanding:
Customer OAuth end-to-end: NOT TESTED; implementation pending on Aiden's computer
Files changed and checks run:
Return branch and pushed commit SHA:
```

Treat an external testing invite link as team-only unless its distribution is deliberately public. Do not commit live customer identifiers or records. Keep any credentials solely in the chosen private store.

Run relevant checks for any generated app/configuration files, plus `git diff --check`. Commit task files and push `codex/eric-oauth-setup` with upstream tracking. Verify the remote SHA matches HEAD. Do not force-push or merge into `main`. Put the final SHA in the return message after committing; the results document can identify its containing commit without embedding its own hash.

Give Eric a short message to paste into Aiden's existing chat: repository, branch, commit, registrations completed, secret locations, checks and blockers. No automated message to Aiden is necessary.

## Aiden's work after the return

Fetch and review Eric's branch, then integrate the relevant registration files into `codex/aiden-aws-harness`. Finish authenticated OAuth start/callback routes, one-use expiring state bound to the workspace, Supabase PKCE, server-side code exchange and secret loading, encrypted token storage, refresh, disconnect/revocation, account/project binding, mapping approval and case-scoped evidence retrieval. Preserve the authenticated AWS bridge and prevent authorization codes or tokens from appearing in logs.

Test denial, callback replay, wrong-workspace access, refresh and disconnect with synthetic fixtures first. Deploy backend and frontend together as needed. Then send Eric the Connections link for the actual customer authorization flow and a read-only investigation of one explicitly selected real dispute. This later live test is the proof that the connector works.
