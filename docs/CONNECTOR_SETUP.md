# Reusable evidence connector: guided setup

Causality's Connections wizard saves a reviewed mapping, previews fictional evidence, and downloads the installation files. The packaged connector creates the evidence endpoint; a business does not write an HTTP handler or case query. The AWS investigator uses the same evidence contract for ticketing and rentals.

This release provides a guided installer. Supabase OAuth authorization, schema discovery, automatic hosting, and a production connection registry are not implemented. Saving or previewing a mapping does not connect a live database. The wizard examples describe fictional schemas and records, not the production ATMSPHR or Rentul database. The specialized production-schema adapter remains in `integrations/atmsphr/`.

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

## 5. Connect the deployed service to AWS

The current live connection is configured by the Causality operator, separately from the wizard's saved mapping. Preserve existing settings while adding these private environment variables to **both** `causality-hackathon-backend` and `causality-hackathon-investigator`:

- `MERCHANT_EVIDENCE_URL`: deployed HTTPS base URL.
- `MERCHANT_EVIDENCE_TOKEN`: credential from the private `case-token.secret` file.
- `MERCHANT_WORKSPACE_ID`: the exact Causality workspace allowed to import the case.

Use the existing AWS deployment/configuration process. Do not paste keys into a shell command, Git, screenshots, or this document. The current configuration supports one case-bound merchant credential per workspace connection; a managed multi-case credential registry is future work.

Verify that the approved case imports through the workspace, that another case is denied, and that a Bedrock investigation preserves source citations. A saved onboarding mapping remains a draft and does not change these live settings. No production database, Stripe account, permission, or external deployment is changed by the installer itself.

## Revocation and updates

Set a grant's `revoked` field to `true` or remove its entry from the private grant file. Use an atomic replacement with mode `0600` for operational updates. The server reloads this file on every request and again before releasing evidence, so a change during a read blocks the response. Remove the corresponding AWS connection credential when disconnecting the service. Mapping changes require a reviewed manifest update and service restart.

## Verification

```sh
npm --prefix integrations/evidence-connector test
npm --prefix integrations/evidence-connector run typecheck
```

Tests cover the existing merchant wire contract, partial dispute amounts, Stripe mismatch rejection, tenant/order scope, expiry/revocation, private setup output, read-only permissions, and the actual HTTP boundary. Embedded PostgreSQL tests execute the generated SQL against both example schemas with unrelated orders and colliding merchant IDs. The generated role denies unmapped private columns and writes. All test records are fictional.
