# Eric → Aiden: provider registration results

Verified November 7, 2026 (America/Los_Angeles).

Repository: https://github.com/ericshteremberg/champs-scu-aws-hackathon

Return branch: `codex/eric-oauth-setup`.
Based on `origin/codex/aiden-aws-harness` at `44ec7e9`.
The pushed commit containing this document is the return revision; the exact
SHA is in Eric's return message. No merge into main or shared deployment was made.

## Status

**Supabase developer registration: COMPLETE.**
**Stripe app registration and external testing: COMPLETE.**
**Stripe developer credential storage: approved by Eric; awaiting Stripe email identity verification before key creation.**
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
profile proves developer access, not Lambda access. Add the Stripe ARN only after its credential is securely stored and verified.

No secret values, authorization links, or customer tokens are in this branch.
The temporary `.env.oauth.local` was ignored by Git and mode `0600` before removal.
The AWS secret is the cross-computer credential handoff; no local file transfer
is necessary for Supabase.

## Stripe registration

Developer owner: **Black Label Creators LLC**, account `acct_1U33O9QjrrTJzQt3`,
live mode, explicitly selected by Eric.

| Item | Verified result |
| --- | --- |
| App ID | `com.blacklabelcreators.causality` |
| Unique app ID | `app_61VimchfX0Y9Qjo6t41QjrrTJzQt39fU` |
| Client ID | `ca_VaZpkG3mZU0HIiQa7qS8p94YHXG2ziQK` |
| Version | `0.1.0` |
| Version ID | `appver_61VimchMAWw3zrC3441QjrrTJzQt3CVM` |
| Upload | `ready`; status `UPLOAD_COMPLETED`, no warnings |
| Authentication | OAuth |
| Distribution | Public draft; not Marketplace published |
| External testing | Enabled for 0.1.0, live link captured privately |
| Access | Anyone with the link; only alternative offered was Closed |
| Testers / installs | 0 of 25 testers / 0 installations |
| Permissions | `dispute_read`, `charge_read` only |
| Callback | `https://causality-hackathon-dev.slidah60.workers.dev/api/providers/stripe/callback` |
| Developer credential | Creation and AWS storage approved; Stripe requires Eric to complete email verification first |
| Authorization link location | Temporary ignored mode-0600 `.env.oauth.local`; not yet available cross-computer |

Eric reviewed and accepted the Stripe Apps developer agreement himself, then
explicitly approved setting 0.1.0 as the external-test version. The exact link
was copied from **External testing → Test OAuth → Live mode link**, not the
ordinary public install links that require Marketplace publication. It opened
Causality's **Test version** invitation, then the account selector. Account
selection and the final customer consent permissions screen remain unverified;
no installation was performed against the not-yet-implemented callback.

The manifest requests no writes. `charge_read` also covers refund reads.
`connected_account_read` was not added because no implemented verification
endpoint demonstrated a need. Eric explicitly approved creating a dedicated standard live key and storing it
in the verified AWS secret. Stripe then required email identity verification
before creation; no new key has been issued or stored yet.

Standard developer credentials have full access
to the developer account; these are separate from customer OAuth grants, which
are limited by the app permissions. The credential is for server-side OAuth
exchange/refresh and must never be exposed through the frontend or legacy
`STRIPE_RESTRICTED_KEY` path.

### Resolved CLI blocker

The earlier HTTP 403 was not proof that the account lacked Apps access.
`stripe login list`/`stripe whoami` showed authorization, while the active
request context remained a sandbox. A direct live account request exposed the
mismatch. `stripe switch acct_1U33O9QjrrTJzQt3 --live --format json` fixed it.
The apps plugin 1.25.1 and generate plugin 0.12.0 then installed successfully
with CLI 1.53.1. `stripe agent setup` had installed coding-agent tooling but
had not selected the live request context. The earlier feedback report
`fbk_VaZgmDj73GR9WB` describes the now-resolved symptom, not a current blocker.

The official generator created a workspace; its example UI was removed for
this backend-only app. The actual uploaded `stripe-app.json`, package lock,
brand assets and repeatable commands are under `integrations/stripe-app/`.
The older proposed `registration.json` has been replaced by the validated manifest.

## Files and checks

- `integrations/stripe-app/stripe-app.json`: actual uploaded manifest.
- `integrations/stripe-app/package.json`, `package-lock.json`, `.gitignore`: upload workspace.
- `integrations/oauth/stripe-registration.json`: nonsecret registered metadata.
- `integrations/stripe-app/icon.svg`, `icon.png`: existing Causality branding.
- `integrations/stripe-app/README.md`: reproducible setup contract and unblock steps.
- `integrations/oauth/supabase-registration.json`: nonsecret registered metadata.
- `integrations/oauth/secrets-read-policy.json`: narrow, unapplied backend IAM policy.
- This results document.

Checks passed: JSON parsing; exact callback/read-scope assertions; IAM action and
exact secret ARN matching; PNG header and 300 × 300 dimensions; `git diff --check`;
ignored-file and mode check; actual AWS secret field-presence verification;
reopened Supabase saved settings. These are registration/configuration checks,
not customer OAuth tests. Stripe CLI upload validation passed separately as recorded above. No application code changed,
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
4. Finish secure Stripe developer key storage after Eric completes provider verification, then
   implement Stripe OAuth using the registered app and exact private live test
   URL. Preserve denial, replay, wrong-workspace, refresh and disconnect checks.
   Complete the customer consent permission review with Eric before installation.
5. Deploy backend and frontend together when ready. Only then ask Eric to use the
   Connections page for actual customer consent and an explicitly selected live
   dispute. The callbacks are still implementation targets, not verified routes.

References: [original registration contract](05-eric-oauth-registration.md),
[Supabase integration guide](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration),
[Supabase read-only query endpoint](https://supabase.com/docs/reference/api/v1-read-only-query),
[Stripe OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth),
[Stripe permissions](https://docs.stripe.com/stripe-apps/reference/permissions).
