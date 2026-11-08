import type { ConnectorManifest } from '../../lib/evidence-connectors/types.ts';
import { connectorManifestSchema, quoteIdentifier as identifier } from '../../lib/evidence-connectors/core.ts';

export type ConnectorInstallFiles = { files: { name: string; content: string }[]; instructions: string[] };

/** Only identifiers from a validated manifest enter generated SQL. No credentials or case data. */
export function buildReadRoleSql(manifest: ConnectorManifest) {
  manifest = connectorManifestSchema.parse(manifest);
  const tables = new Map<string, Set<string>>();
  const add = (table: string, columns: string[]) => {
    identifier(table);
    const selected = tables.get(table) ?? new Set<string>();
    columns.forEach(column => { identifier(column); selected.add(column); });
    tables.set(table, selected);
  };
  const order = manifest.order;
  add(order.table, [order.id, order.merchantId, order.orderRef, order.paymentRef, order.amount, order.currency, order.purchasedAt]);
  for (const section of Object.values(manifest.sections)) {
    if (section) add(section.table, [section.id, section.orderId, section.merchantId, section.occurredAt, ...Object.values(section.fields)]);
  }
  const schema = identifier(manifest.schema);
  return [
    '-- Generated read-role proposal. Review before running as the merchant database administrator.',
    '-- This does not create a login, set a password, change RLS, grant writes, or bypass RLS.',
    '-- Connect this role to a restricted login only after reviewing existing memberships and policies.',
    '-- The connector enforces case scope in parameterized queries; column grants alone do not impose row scope.',
    '-- If your schema differs, create approved scoped views or adjust the mapping before installation.',
    'CREATE ROLE causality_evidence_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;',
    `GRANT USAGE ON SCHEMA ${schema} TO causality_evidence_reader;`,
    ...Array.from(tables, ([table, columns]) => `GRANT SELECT (${[...columns].sort().map(identifier).join(', ')}) ON ${schema}.${identifier(table)} TO causality_evidence_reader;`),
    '',
  ].join('\n');
}

export function buildConnectorInstallFiles(manifest: ConnectorManifest): ConnectorInstallFiles {
  const instructions = [
    'Download manifest.json and read-role.sql. Confirm the table relationships and selected fields against your database.',
    'Clone the codex/aiden-aws-harness branch of the Causality repository and run npm ci at its root, then npm --prefix integrations/evidence-connector ci.',
    'Run npm run connector:setup -- --manifest /absolute/path/manifest.json --out /absolute/path/private-connector.',
    'Have your database administrator review read-role.sql, create a restricted login, and confirm RLS permits only the intended business records.',
    'Create an approved case grant using the generated example, then rerun setup in a NEW private output directory with --grant /absolute/path/approved-case.json. The private case token is saved to case-token.secret.',
    'Set EVIDENCE_DATABASE_URL and EVIDENCE_STRIPE_READ_KEY in the NEW private connector.env file. Keep all credentials outside chat and version control.',
    'Run npm run connector:check -- --env-file /absolute/path/private-connector/connector.env, then npm run connector:start with the same --env-file.',
    'Deploy this packaged service behind HTTPS. The Causality operator must set MERCHANT_EVIDENCE_URL, MERCHANT_EVIDENCE_TOKEN, and MERCHANT_WORKSPACE_ID on BOTH AWS Lambda functions, then verify the approved case import. Saving a mapping in the wizard does not activate this live connection.',
  ];
  return {
    files: [
      { name: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
      { name: 'read-role.sql', content: buildReadRoleSql(manifest) },
      { name: 'INSTALL.md', content: [
        '# Causality guided connector installation', '',
        'This package configures a reusable endpoint. You do not need to write an HTTP service.', '',
        'The onboarding examples use fictional records. Saving a mapping does not connect a production database.', '',
        '```sh',
        'git clone --branch codex/aiden-aws-harness https://github.com/ericshteremberg/champs-scu-aws-hackathon.git',
        'cd champs-scu-aws-hackathon',
        'npm ci',
        'npm --prefix integrations/evidence-connector ci',
        'npm run connector:setup -- --manifest /absolute/path/manifest.json --out /absolute/path/private-connector',
        '```', '',
        ...instructions.map((instruction, index) => `${index + 1}. ${instruction}`), '',
        'Repository: https://github.com/ericshteremberg/champs-scu-aws-hackathon', '',
        'Read docs/CONNECTOR_SETUP.md for the full setup and revocation procedure. The supplied templates describe example schemas, not a guarantee that the production ATMSPHR or Rentul database has those fields.', '',
        'OAuth deployment is not included in this guided installer. Setup permissions are separate from the restricted credential used during investigations.', '',
      ].join('\n') },
    ],
    instructions,
  };
}
