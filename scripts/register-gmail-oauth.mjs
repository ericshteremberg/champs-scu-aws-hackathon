import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { CreateSecretCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { loadAwsSession } from './load-aws-session.mjs';

// Explicit operator tool. Reads a downloaded Google Web OAuth client file locally;
// never accepts credentials in arguments and never prints secret-bearing errors.
async function main() {
  const file = process.argv[2];
  if (!file || !isAbsolute(file) || process.argv.length !== 3) throw new Error('usage');
  const configPath = new URL('../integrations/oauth/gmail-registration.json', import.meta.url);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const client = JSON.parse(readFileSync(file, 'utf8')).web;
  if (!client || typeof client.client_id !== 'string' || !client.client_id.endsWith('.apps.googleusercontent.com') || typeof client.client_secret !== 'string' || !client.client_secret || !client.redirect_uris?.includes(config.redirectUri)) throw new Error('configuration');
  loadAwsSession();
  const identity = await new STSClient({ region: config.region }).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== config.accountId) throw new Error('account');
  const secrets = new SecretsManagerClient({ region: config.region });
  const SecretString = JSON.stringify({ clientId: client.client_id, clientSecret: client.client_secret, redirectUri: config.redirectUri, scopes: config.scopes });
  let result;
  try { result = await secrets.send(new CreateSecretCommand({ Name: config.secretName, SecretString })); }
  catch (error) { if (error.name !== 'ResourceExistsException') throw error; result = await secrets.send(new PutSecretValueCommand({ SecretId: config.secretName, SecretString })); }
  if (!result.ARN) throw new Error('storage');
  writeFileSync(configPath, JSON.stringify({ ...config, registrationStatus: 'credentials_stored_customer_oauth_untested', secretArn: result.ARN }, null, 2) + '\n');
  console.log('Google credentials saved in AWS Secrets Manager. Nonsecret registration metadata updated.');
  console.log('Next: run npm run deploy:aws, then test Connect Gmail in the app. Commit only the registration metadata, never the downloaded client file.');
}
main().catch(() => { console.error('Gmail registration was not completed. Check the absolute Google Web client JSON path, exact callback, AWS account and current credentials. No credential values were printed.'); process.exitCode = 1; });
