# Reusable evidence connector: guided setup

Causality's Connections wizard saves a reviewed mapping, previews fictional evidence, and downloads the installation files. The packaged connector creates the evidence endpoint; a business does not write an HTTP handler or case query. After deployment, the business connects and manages its approved case in the app. The AWS investigator uses the same evidence contract for ticketing and rentals.

The Connections page now also provides [Stripe and Supabase OAuth onboarding](OAUTH_CONNECTORS.md). Authorize Stripe and explicitly verify its read access. Authorize Supabase, select a project, inspect public-schema table/column names and save an approved evidence scope. It does not yet query business rows in Supabase or import live disputes. Verified payment-to-order mapping remains outstanding. This path requires no merchant-hosted endpoint.

The installation instructions below describe the separate guided installer and AWS-backed live endpoint registry. Saving or previewing a mapping does not connect a live database. The wizard examples describe fictional schemas and records, not the production ATMSPHR or Rentul database. The specialized production-schema adapter remains in `integrations/atmsphr/`.

## 1. Download and install the connector

Use Connections, Add evidence connector to review an example mapping and select the evidence fields to share. Download `manifest.json`, `read-role.sql`, and `INSTALL.md`. A live mapping must be reviewed against the actual database schema; the packaged runtime validates its structure and reads only mapped columns.

Until this feature branch is merged, use the branch explicitly:

```sh
git clone --branch codex/aiden-aws-harness https://github.com/ericshteremberg/champs-scu-aws-hackathon.git
cd champs-scu-aws-hackathon
npm ci
npm --prefix integrations/evidence-connector ci
npm run connector:setup -- --manifest /absolute/path/manifest.json --out /absolute/path/private-connector
```

Use Node 22.13 or newer. The setup command validates the mapping and creates a new private directory containing the reviewed mapping, permission proposal, instructions, a revoked grant example, an empty grant registry, and a private environment-file scaffold. It never changes database permissions, prints a credential, or overwrites an existing installation.

The package references shared code in this repository, so run it from the checkout with root and connector dependencies installed. No customer database credentials enter the wizard or AWS from this setup step.

## 2. Review database access

The merchant database administrator reviews the generated `read-role.sql` before applying it. It creates a `NOLOGIN`, `NOBYPASSRLS` role with `SELECT` on the exact required columns. It does not create a password, change RLS, grant writes, or impose a row policy. Provision a restricted login with these permissions and the intended RLS policies using the business's normal administration process. Do not use the Supabase administrative or service-role credential.

The generic mapping expects an order table or approved view with a merchant ID, order ID/reference, payment reference, integer total in minor units, currency, and purchase timestamp. Linked tables or approved views must expose both order and merchant references. For complex joins, a database administrator can prepare reviewed views. View ownership and RLS behavior also need review; a mapping name alone does not guarantee a view preserves tenant restrictions.

Every actual query constrains the merchant, order, order reference and payment reference before fetching rows. Child queries join both order and merchant. Queries are parameterized, use selected columns and bounded results, and run in a read-only repeatable-read transaction. Both service startup and the check command reject privileged roles or mapped-table write privileges and verify columns using zero-row reads. This checks the mapped access path, not every possible privilege elsewhere in a database.

## 3. Approve a real case

Copy `case-grant.example.json` to a private file. Replace every placeholder using a business-approved dispute and set `revoked` to `false`. The grant requires:

- Case ID, merchant ID, internal order ID, and order reference.
- Stripe PaymentIntent, dispute, and processing account IDs, plus test/live mode.
- An expiry within 30 days, a pseudonymous customer label, the customer's claim, and the event or rental name.

Case IDs may contain letters, digits, underscores and hyphens, up to 64 characters. Never infer a payment relationship from email alone. The service independently verifies the Stripe dispute, charge, PaymentIntent, account context, mode, currency, and total against the mapped purchase before returning live evidence. A partial dispute can be less than the original paid total.

Create the active installation in a new private directory:

```sh
npm run connector:setup -- --manifest /absolute/path/manifest.json --out /absolute/path/active-connector --grant /absolute/path/approved-case.json
```

The generated `case-token.secret` contains the case credential. The server's `grants.json` stores only its SHA-256 digest alongside the grant. These files and `connector.env` are mode `0600`; the output directory is mode `0700`. Keep them outside Git and chat. Setup without `--grant` creates no live access.

## 4. Configure and run

Edit the active private `connector.env` file locally:

| Setting | Value |
| --- | --- |
| `EVIDENCE_MANIFEST_FILE` | Generated absolute manifest path. |
| `EVIDENCE_GRANTS_FILE` | Generated absolute private grant-registry path. |
| `EVIDENCE_DATABASE_URL` | Restricted PostgreSQL TCP connection string, including a password if required. Query parameters, fragments and socket hostnames are rejected so they cannot override TLS, timeouts or read-only defaults. |
| `EVIDENCE_DATABASE_CA` | Optional trusted CA certificate text. TLS verification is always enabled; URL SSL overrides are rejected. |
| `EVIDENCE_STRIPE_READ_KEY` | Restricted Stripe key with the required dispute and charge reads for the approved account and mode. |
| `HOST`, `PORT` | Defaults `127.0.0.1`, `8789`. Configure the host for your deployment's private proxy or container network. |

```sh
npm run connector:check -- --env-file /absolute/path/active-connector/connector.env
npm run connector:start -- --env-file /absolute/path/active-connector/connector.env
```

The check command reads metadata and uses zero-row schema probes, without printing customer records. A successful check does not establish that a live case is valid. The first evidence request must also pass Stripe verification, grant checks, and matching source reads.

Host this service in the merchant's environment behind HTTPS. The packaged service supplies `GET /v1/cases/{caseId}/evidence?section=summary|order|tickets|delivery|history|support|attendance|policy`. A bearer credential authorizes one approved case; a different case, expired credential, or revoked credential is denied. Responses use no-store caching and bounded payloads. Do not expose the local plaintext listener directly to the internet.

## 5. Connect the deployed service in the app

Open Connections and add a live evidence connection. Enter a display name, the deployed public HTTPS base URL, the approved external case ID, and its credential from the private `case-token.secret` file. This credential is for the case evidence API, not a database login or Supabase administrative key.

Causality verifies the live summary and payment/order mapping, then sends a random unrelated case ID and requires HTTP 401, 403, or 404. This is an access-scope smoke check: a missing-case response cannot prove that the token cannot access other existing cases. Causality only requests the configured approved case; the merchant service must enforce its case grant. The connection is saved only after the summary and smoke check pass. The AWS transport rejects private or local destinations and redirects, validates DNS, and bounds request time and response size. The app can recheck access, import the approved case, or disconnect. Recheck refuses a changed merchant, order, or payment identity.

`GET /api/connectors/live` lists the owning workspace's public connection metadata. POST actions are `connect`, `recheck`, `import`, and `disconnect`. Each live connection is configured to request one approved case; a workspace supports up to 30 saved connections, including disconnected records. The token is stored in a separate private DynamoDB item under `connector-credential#`, while public metadata uses `live-connection#`. DynamoDB encrypts the table at rest. This is not application-level encryption or Secrets Manager storage. Tokens never appear in returned connection metadata, workspace state, or audit details.

This flow requires no Lambda environment change. The legacy operator-managed `MERCHANT_EVIDENCE_URL`, `MERCHANT_EVIDENCE_TOKEN`, and `MERCHANT_WORKSPACE_ID` configuration remains optional on both Lambdas for older connections. Keep credentials out of chat, Git, screenshots, and shell command history.

Import the approved case, inspect its summary mapping, and verify that a Bedrock investigation preserves source citations. A saved onboarding mapping remains a draft until a deployed service is connected separately. No production database, Stripe account, permission, or external deployment is changed by the installer itself. The development deployment still uses the shared team login; it is not production multi-user authentication.

## Revocation and updates

Disconnect in Connections to atomically disable the saved connection and delete its private credential. Later managed reads and result publication are blocked, including publication that races with disconnection. Previously imported evidence remains available. Disconnecting Causality does not invalidate other copies of the same token.

Also set the merchant grant's `revoked` field to `true` or remove its entry from the private grant file to invalidate those copies at the source. Use an atomic replacement with mode `0600` for operational updates. The server reloads this file on every request and again before releasing evidence, so a change during a read blocks the response. Mapping changes require a reviewed manifest update and service restart.

## Verification

```sh
npm --prefix integrations/evidence-connector test
npm --prefix integrations/evidence-connector run typecheck
npx vitest run --config vitest.config.ts tests/aws-managed-connectors.test.ts tests/aws-merchant-network.test.ts
```

Tests cover the existing merchant wire contract, partial dispute amounts, Stripe mismatch rejection, tenant/order scope, expiry/revocation, private setup output, read-only permissions, and the actual HTTP boundary. Embedded PostgreSQL tests execute the generated SQL against both example schemas with unrelated orders and colliding merchant IDs. The generated role denies unmapped private columns and writes. All test records are fictional.

The AWS registry tests cover credential separation, workspace isolation, strict inputs, sanitized failures, changed case identity, atomic disconnection, and concurrent update conflicts. Transport tests exercise public destination checks and bounded requests. These tests do not establish that a customer's real endpoint or database is connected.

With the development AWS deployment and Wrangler credentials available, `npm run test:connectors:live` deploys a temporary HTTPS fixture containing only fictional evidence. It verifies the real AWS connection, import, Bedrock investigation, citations, and disconnect flow, then deletes the fixture and its two isolated test workspaces. The fixture stores no Cloudflare database records. Use `npm run test:connectors:live -- --dry-run` for local fixture and bundle checks only. Smoke results are written to ignored `.aws-build/managed-connector-smoke.json`.

## Gmail

Use the Gmail card under Connect your business to authorize, select a case, search its customer email, preview a message and explicitly import it. The one-time Google developer setup is documented in [the Gmail registration handoff](handoffs/06-gmail-oauth-registration.md). Customers do not need API keys or a custom endpoint. Registration is currently pending. This flow reads mail only; it does not send messages. Plain-text imports preserve source IDs and clear prior case draft approval. HTML and attachments require manual review/import.
