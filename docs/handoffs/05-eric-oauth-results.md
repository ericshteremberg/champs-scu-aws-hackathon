# Eric → Aiden: provider registration results

Verified November 7, 2026 (America/Los_Angeles).

Repository: https://github.com/ericshteremberg/champs-scu-aws-hackathon

Return branch: `codex/eric-oauth-setup`.
Based on `origin/codex/aiden-aws-harness` at `44ec7e9`.
The pushed commit containing this document is the return revision; the exact
SHA is in Eric's return message. No merge into main or shared deployment was made.

## Status

**Supabase developer registration: COMPLETE.**
**Stripe developer registration: BLOCKED by Stripe CLI plugin authorization.**
**Customer OAuth end-to-end: NOT TESTED; implementation pending on Aiden's computer.**

Registration does not establish a customer connection. Neither provider's
customer authorization/install flow was completed, and no live dispute, customer
record, refund, message, or merchant database was modified by this setup.

## Supabase

Eric selected Orbit; its owning organization is **Glowchat**, which now owns
the Causality OAuth application. No replacement organization or project was created.

| Setting | Registered value |
| --- | --- |
| Application name | Causality |
| App ID | `4ae2f41e-b308-4f76-af4d-56b110d0dbd0` |
| Client ID | `708982e7-e164-45b1-b230-7f3d1d2cf48b` |
| Website | `https://causality-hackathon-dev.slidah60.workers.dev` |
| Callback | `https://causality-hackathon-dev.slidah60.workers.dev/api/providers/supabase/callback` |
| Scopes | `projects:read`, `database:read` |
| All other scope categories | No access |

Checks actually performed:

- Confirmed no pre-existing published Causality app in the selected organization.
- Reviewed the consent preview: only Database and Projects, READ.
- Created the app with Eric's explicit approval and captured the one-time client
  secret directly to a private file without printing it.
- Reopened the saved app's Edit form and verified the exact website, callback,
  and both read-only categories; no extra scopes were enabled.
- The organization's Authorized apps list remained empty: developer registration
  did not grant Causality access to Orbit or another customer's project.
- Stored the credential in AWS and verified required fields, exact callback, and
  exact scopes without printing credential values. Removed the temporary local
  credential file after successful AWS verification.

The registration UI offered no description field. No extra scopes or business
URLs were invented. No further provider review/billing requirement was presented
for this registration. Actual customer consent and API access remain untested.

## AWS credential handover

Verified local profile `scu-hackathon` through STS as
`WSParticipantRole/Participant`, account `156129572861`. The same account owns
`causality-hackathon-dev` in `us-east-1`; CloudFormation reported `UPDATE_COMPLETE`.
The initial default-profile check found no credentials; the named profile works.

Secret name: `causality/dev/oauth/supabase`

Secret ARN:
`arn:aws:secretsmanager:us-east-1:156129572861:secret:causality/dev/oauth/supabase-cWTJnA`

Region: `us-east-1`.

Stored JSON fields: `clientId`, `clientSecret`, `redirectUri`, `scopes` (array).
All four fields were checked as present/nonempty; callback and scopes matched
the registration contract. `DescribeSecret` confirmed the secret was absent
before creation. No existing credentials were overwritten or rotated.

`integrations/oauth/secrets-read-policy.json` contains a **proposed, unapplied**
IAM policy granting only `secretsmanager:GetSecretValue` on this exact ARN.
Aiden must wire this into the appropriate backend role and implement secret
loading. The Lambda roles and shared stack were not modified. A working workshop
profile proves developer access, not Lambda access. Add the eventual Stripe ARN
only after its registration is completed and verified.

No secret values, authorization links, or customer tokens are in this branch.
The temporary `.env.oauth.local` was ignored by Git and mode `0600` before removal.
The AWS secret is the cross-computer credential handoff; no local file transfer
is necessary for Supabase.

## Stripe blocker and prepared configuration

Developer owner: **Black Label Creators LLC**, live mode, explicitly selected by
Eric. Browser authorization of Stripe CLI succeeded. `stripe login list` and
`stripe whoami` both showed that authorized live account.

The official plugin metadata endpoint returned HTTP 403 with:

```text
Permission denied.
type: api_error
code: unauthorized
```

This prevented `stripe plugin install apps` and the `generate` plugin from
loading. Reproduced with installed CLI **1.53.1** and official npm CLI **1.55.8**.
Eric requested `stripe agent setup`; it completed successfully (1 installed,
0 errors), but the app-plugin request still returned 403 afterward. Agent setup
installs coding-agent tooling; it did not create a Causality Stripe App.

Reported the failure via the Stripe Apps skill's feedback workflow:
`fbk_VaZgmDj73GR9WB`. This is product feedback, not a support ticket or a promise
of a response.

| Item | Result |
| --- | --- |
| Stripe app ID/client ID | Not created/issued |
| Existing Created apps | No app listed when checked |
| App upload | Not performed; official CLI plugins unavailable |
| External testing | Not configured; no external test version/link |
| Authorization URL location | None yet; future AWS secret `authorizeUrl` field |
| Developer API credential | Not obtained; CLI authorization is not the code-exchange credential |
| Stripe secret | `causality/dev/oauth/stripe` does not exist; metadata checked |
| Intended permissions | `dispute_read`, `charge_read` only |
| Intended callback | `https://causality-hackathon-dev.slidah60.workers.dev/api/providers/stripe/callback` |

`integrations/stripe-app/registration.json` preserves the proposed manifest
settings without pretending the official CLI generated or validated a workspace.
The proposed ID `com.blacklabelcreators.causality` is **not registered** and its
global availability is unverified. The directory includes the existing Causality
mark as SVG and a 300 × 300 PNG, plus exact resume steps in its README.

Permission names were verified against the current official permissions
reference. `charge_read` includes reading refund history; no writes were requested.
`connected_account_read` was not added because no implemented verification
endpoint has demonstrated a need for it. App upload, external-test link review,
developer key capture, secret creation, and any provider-specific ownership or
review requirements remain outstanding. Do not substitute a legacy merchant
restricted key, guessed OAuth URL, or test-only link for the required live setup.

## Files and checks

- `integrations/stripe-app/registration.json`: pending registration settings.
- `integrations/stripe-app/icon.svg`, `icon.png`: existing Causality branding.
- `integrations/stripe-app/README.md`: reproducible setup contract and unblock steps.
- `integrations/oauth/supabase-registration.json`: nonsecret registered metadata.
- `integrations/oauth/secrets-read-policy.json`: narrow, unapplied backend IAM policy.
- This results document.

Checks passed: JSON parsing; exact callback/read-scope assertions; IAM action and
exact secret ARN matching; PNG header and 300 × 300 dimensions; `git diff --check`;
ignored-file and mode check; actual AWS secret field-presence verification;
reopened Supabase saved settings. These are registration/configuration checks,
not customer OAuth or Stripe CLI upload validation. No application code changed,
so application builds, Bedrock runs, and synthetic data mutation suites were not run.

## Aiden: next steps

1. Fetch this return branch and review the containing commit. Integrate only the
   registration artifacts you need into `codex/aiden-aws-harness`.
2. Load the Supabase secret from the ARN above in `us-east-1`; implement narrow
   runtime IAM access. Do not paste the secret into Git, logs, frontend variables,
   or chat. No DB password, service-role key, SQL role, schema, or RLS change was needed.
3. Implement Supabase start/callback routes with authenticated workspace binding,
   one-use expiring state, PKCE, server-side exchange, protected token storage,
   refresh, revocation, and correct organization/project binding. Use the agreed
   callback and read-only Management API query endpoint. Enforce approved tables,
   columns, merchant/case filters, and bounded parameterized queries server-side;
   OAuth read scope itself is broader than one case.
4. Resolve the Stripe CLI access blocker, finish the documented developer-app
   upload/external test/key-storage steps, then implement its OAuth flow. Preserve
   denial, replay, wrong-workspace, refresh, and disconnect checks.
5. Deploy backend and frontend together when ready. Only then ask Eric to use the
   Connections page for actual customer consent and an explicitly selected live
   dispute. The callbacks are still implementation targets, not verified routes.

References: [original registration contract](05-eric-oauth-registration.md),
[Supabase integration guide](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration),
[Supabase read-only query endpoint](https://supabase.com/docs/reference/api/v1-read-only-query),
[Stripe OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth),
[Stripe permissions](https://docs.stripe.com/stripe-apps/reference/permissions).
