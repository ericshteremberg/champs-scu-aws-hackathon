# Causality Stripe developer app

Version **0.1.0** is uploaded in the live Black Label Creators LLC account and
enabled for external testing. It is a backend-only OAuth app with no Dashboard
UI extension. Public distribution is still a draft; it is not Marketplace published.

## Registered configuration

- Developer account: `acct_1U33O9QjrrTJzQt3` (Black Label Creators LLC), live.
- App ID: `com.blacklabelcreators.causality`.
- Unique app ID: `app_61VimchfX0Y9Qjo6t41QjrrTJzQt39fU`.
- Client ID: `ca_VaZpkG3mZU0HIiQa7qS8p94YHXG2ziQK`.
- Version ID: `appver_61VimchMAWw3zrC3441QjrrTJzQt3CVM`.
- Name: Causality.
- Description: Investigate ticket disputes using payment records and relevant order, ticket, delivery and attendance evidence.
- Website: https://causality-hackathon-dev.slidah60.workers.dev
- Callback: https://causality-hackathon-dev.slidah60.workers.dev/api/providers/stripe/callback
- Permissions: `dispute_read` and `charge_read` only. The latter includes refund reads.
- External testing: version 0.1.0, **Anyone with the link**, 0 of 25 testers when checked.
  The only other offered access setting was Closed. Keep the exact live test URL
  private; ordinary public install links require publication.

## Reproducible workspace

`stripe-app.json` comes from the official generator. Its sample UI was removed;
the upload command normalized empty UI/extension fields to the format preserved
here. `registration.json` was the earlier pending proposal and has been removed.
The existing Causality mark is preserved as SVG and a 300 × 300 PNG.

The earlier plugin HTTP 403 was an active-context problem: `stripe login list`
and `stripe whoami` showed authorization, but a live request was still using a
sandbox context. Selecting the approved account resolved it:

```sh
stripe switch acct_1U33O9QjrrTJzQt3 --live --format json
stripe plugin install apps
stripe plugin install generate
```

Verified with Stripe CLI 1.53.1, apps plugin 1.25.1, generate plugin 0.12.0.
The source scaffold was produced in a temporary directory using:

```sh
stripe generate app causality --id com.blacklabelcreators.causality --display-name Causality --non-interactive --format json
```

From the repository root, the actual successful validation/upload was:

```sh
stripe apps upload integrations/stripe-app --live --non-interactive --wait --format json
stripe apps status com.blacklabelcreators.causality --version 0.1.0 --live --format json --non-interactive
```

Upload returned `ready`; status returned `UPLOAD_COMPLETED` and no warnings.
Do not upload this same immutable version again just to verify it. Future changes
need a new version and review of permissions. Eric accepted Stripe's developer
agreement himself and explicitly approved setting the external-test version.

## Credential and implementation boundary

The verified private AWS secret is `causality/dev/oauth/stripe` in account
`156129572861`, `us-east-1`. Fields: `clientId`, `developerApiKey`, `authorizeUrl`,
`mode` (`live`), `redirectUri`. Secret ARN: `arn:aws:secretsmanager:us-east-1:156129572861:secret:causality/dev/oauth/stripe-gFclXy`. All fields were verified after storage; temporary local credential staging was removed.
The standard live developer key has full developer-account API access. Customer
OAuth grants are separately limited by this app's read permissions. Never use a
CLI token, customer key, or restricted key in its place, and never put it in
frontend code, Git, logs, or the legacy `STRIPE_RESTRICTED_KEY` setting.

The exact Dashboard external-test link opened Causality's Test version invite.
The consent preview for the approved developer account showed only Charges and
Refunds (Read-only) and Payment Disputes (Read-only). We exited without submitting
Install app. Customer installation was not completed. Callback routes,
OAuth exchange/refresh, protected customer tokens and end-to-end verification
remain Aiden's implementation work; registration alone is not a working connector.

References:
[OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth),
[permissions](https://docs.stripe.com/stripe-apps/reference/permissions),
[external testing](https://docs.stripe.com/stripe-apps/test-app),
[results handoff](../../docs/handoffs/05-eric-oauth-results.md).
