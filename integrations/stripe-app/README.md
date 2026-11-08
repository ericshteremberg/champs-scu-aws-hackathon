# Causality Stripe developer registration — pending upload

This directory preserves the intended backend-only OAuth app configuration and
authored brand assets. **It is not an uploaded or installed Stripe app.**

`registration.json` contains the proposed manifest settings, based on Stripe's
[manifest reference](https://docs.stripe.com/stripe-apps/reference/app-manifest).
It is named separately from a CLI-generated manifest deliberately: the official
generator could not run, so this is a registration input, not a validated CLI
workspace. The proposed ID has not been checked for global availability.

## Registration contract

- Developer owner: Black Label Creators LLC, live account, explicitly selected by Eric.
- Name: Causality.
- Description: Investigate ticket disputes using payment records and relevant order, ticket, delivery and attendance evidence.
- Website: https://causality-hackathon-dev.slidah60.workers.dev
- Callback: https://causality-hackathon-dev.slidah60.workers.dev/api/providers/stripe/callback
- Only `dispute_read` and `charge_read`. The latter also permits reading refunds.
  Neither permission permits writes. No account, customer, file, or event scope
  has been added. Revisit `connected_account_read` only if account verification
  demonstrably requires it.
- `icon.svg` is the existing Causality mark from `public/favicon.svg`;
  `icon.png` is its 300 × 300 raster export.

## Confirmed blocker, November 7, 2026

Browser CLI authorization succeeded and `stripe whoami`/`stripe login list`
identified the intended live account. However, the official plugin metadata
endpoint returned HTTP 403 `Permission denied` / `unauthorized` for both `apps`
and `generate`. Reproduced with installed CLI 1.53.1 and official npm CLI 1.55.8.
`stripe docs` also returned 403; the Stripe documentation connector and official
web documentation were used to verify the intended configuration instead.

No app appeared in the developer account's Created apps list. No app version,
client ID, external test link, or developer API credential was obtained. Do not
treat the account identifier or this proposed manifest ID as an OAuth client ID.

## Resume after CLI access is fixed

1. Confirm `stripe whoami` targets the approved live developer account. Resolve
   the plugin endpoint authorization failure; do not create a replacement
   customer account, broaden customer scopes, or install against missing callbacks.
2. Run `stripe plugin install apps` and `stripe plugin install generate`.
3. Use `stripe generate app` to generate the official workspace in a temporary
   directory, following its current help. Preserve the generated configuration
   and dependency versions under this directory. Apply `registration.json` to
   the generated manifest using the format supported by that CLI version.
   Do not leave example Dashboard UI extensions in this backend-only app.
4. Run the generated workspace's applicable checks, then `stripe apps upload`.
   Stripe's validator is still required; local JSON checks do not prove uploadability.
5. In Created apps → Causality → External test, configure the uploaded version
   for external testing, limiting intended testers where supported. Copy the
   exact Dashboard-provided live OAuth test URL privately. Public Marketplace
   install links do not work before publication. Do not submit for public review
   or invent privacy/support details.
6. Obtain the developer account's live API credential needed for OAuth code
   exchange through an approved secure mechanism. A CLI login token is not that
   credential. Store it in `causality/dev/oauth/stripe` in the verified team AWS
   account, `us-east-1`, using fields `clientId`, `developerApiKey`, `authorizeUrl`,
   `mode: "live"`, and `redirectUri`. Inspect existing secret metadata first;
   never overwrite an unknown secret. Never put it in `STRIPE_RESTRICTED_KEY`.
7. Open the exact external test URL and verify the intended app/permissions,
   stopping before customer installation. Record app/client IDs, actual callback,
   test mode, secret ARN, and checks in the return handoff.

References:
[OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth),
[permissions](https://docs.stripe.com/stripe-apps/reference/permissions),
[external testing](https://docs.stripe.com/stripe-apps/test-app).
