# Gmail developer registration and customer test

Gmail's AWS runtime, Connections UI and one-time Google developer registration are complete. The AWS deployment has been updated with the secret ARN. Customers click Connect Gmail and consent through Google; real customer consent, token exchange and mailbox reads are still untested.

Registration uses the personal Google account selected by Aiden, project `Causality Gmail` (`fifth-liberty-514107-c3`, project number `766596255060`). The Gmail API is enabled. The Web client is `Causality Gmail Dev`; audience is External / Testing, with only `gmail.readonly`. Credentials are stored in AWS Secrets Manager at `causality/dev/oauth/gmail` in account `156129572861`, `us-east-1`. The exact ARN and callback are in `integrations/oauth/gmail-registration.json`. No client secret is committed.

Aiden's selected personal Google account is a saved test user. Google rejected Eric's supplied business address as not associated with an active Google account, so it was not added. A Network Solutions-hosted mailbox cannot authorize through this Gmail connector. Use the separate [IMAP connector](../IMAP_CONNECTOR.md); it is implemented but still requires the real customer mailbox test. Network Solutions documents the mailbox username/password and domain-specific incoming-server settings in its [IMAP setup guide](https://www.networksolutions.com/help/article/how-do-i-get-started-with-pop3-and-imap). Keep any mailbox credentials out of chat and Git.

## Operator reference: recreate or rotate the registration

1. In a Google Cloud project owned by the business that should own Causality, enable the **Gmail API**. Configure Google Auth Platform branding, audience and data access. For the hackathon use External / Testing and explicitly add the intended Gmail test users, including the mailbox that will be tested. Supply accurate app/support information.
2. Request exactly `https://www.googleapis.com/auth/gmail.readonly`. Do not request send, modify, full-mailbox write or domain-wide delegation scopes. Google grants mailbox-wide reads; Causality's case search and review restrictions are application controls, not narrower Google permissions.
3. Create an OAuth client of type **Web application** with this exact authorized redirect URI:

   `https://causality-hackathon-dev.slidah60.workers.dev/api/providers/gmail/callback`

   Credentials stay on Lambda. A browser JavaScript origin is not needed for this server-side code flow. Do not use a Desktop client or OAuth Playground callback.
4. Download that client's JSON to a private local location outside the checkout. With current AWS workshop credentials loaded, run from the repository root:

   ```sh
   node scripts/register-gmail-oauth.mjs /absolute/private/path/google-client.json
   ```

   This explicitly creates or updates `causality/dev/oauth/gmail` in account `156129572861`, `us-east-1`. It validates the account, Web client and callback before saving. It updates only nonsecret ARN/status metadata in `integrations/oauth/gmail-registration.json`. It does not print credentials or install a customer account. Keep the downloaded JSON out of Git and chat.
5. Run `npm run deploy:aws` to grant the Lambda role access to that exact secret ARN and enable the runtime. The frontend is already wired to runtime status. Commit and push the nonsecret registration metadata to the working branch. Give Aiden the commit and test result, never secrets.

AWS secret JSON contract, field names only: `clientId`, `clientSecret`, `redirectUri`, `scopes` (the single read-only Gmail scope). The deployment uses `GMAIL_OAUTH_SECRET_ARN`, or the committed metadata ARN. An existing configured stack value is preserved if neither is supplied.

The hosted start/cancel smoke test passed with `node scripts/smoke-provider-oauth.mjs gmail`, including PKCE, secure cookie, denial/replay handling and rejection of reads while disconnected. It intercepts Google navigation and does not test Google consent or token exchange.

## Customer test, through the website

1. Open Connections in the hosted app and click **Connect Gmail**. Use an explicitly listed Google test user, consent and return to the app. Verify the displayed mailbox is the intended one. No API-key field or customer-side endpoint is involved.
2. Choose an open case with the real customer's email. Click **Find customer emails**. The API searches From/To for that address, excluding Spam and Trash, and returns at most ten message headers. Matching an email address alone does not establish relevance to a specific purchase or dispute.
3. Click **Preview email** on a relevant result. The backend fetches the selected plain-text body. HTML, attachments, attached forwarded messages and unsupported text encodings are excluded. HTML-only mail requires a reviewed manual excerpt. Large messages may be rejected. Long supported text is explicitly truncated to 20,000 characters.
4. Review the text and case, then click **Import reviewed email**. The exact server-held preview becomes Gmail evidence with message/thread IDs, mailbox, headers and timestamp. Prior draft approval is cleared and its source revision becomes stale. Nothing is sent to Gmail or submitted to Stripe.
5. Verify the case evidence, run an investigation when appropriate, and check citations. Confirm duplicate import is rejected. Test another case to check selection isolation. Do not include private email contents in screenshots or Git.
6. Disconnect and confirm further reads stop. A successful Google revocation deletes saved local tokens; a failed revoke retains private credentials only for retry while reads stay disabled. The UI links to Google Account connections for manual revocation. Previously imported evidence remains part of its case.

Real authorization, code exchange, token refresh, Gmail reads and Google revocation still require this customer test. Automated tests use synthetic data and mocked Google responses, not a live mailbox.

## Google testing and production limits

External apps in Testing issue refresh tokens that expire after seven days for Gmail scopes. Reconnect when required. See [Google's token expiration documentation](https://developers.google.com/identity/protocols/oauth2#expiration).

`gmail.readonly` is a restricted scope. Public production distribution requires the applicable Google verification process; server storage/transmission of restricted data also brings security assessment requirements. Treat this deployment as a team prototype, not a verified production OAuth app. See [Google's Gmail scopes documentation](https://developers.google.com/workspace/gmail/api/auth/scopes). Use a dedicated Causality OAuth client, since Google revocation may affect that client's other grants.

The hosted preview still uses shared team authentication. All people using that login share its workspace, authorized mailbox and imported evidence. Production tenant membership and the imported-evidence retention/deletion workflow remain separate work.
