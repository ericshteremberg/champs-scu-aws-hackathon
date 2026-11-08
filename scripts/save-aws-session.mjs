import { writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const names = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
const missing = names.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Missing temporary session variables: ${missing.join(', ')}.`);
  console.error('Run the Workshop Studio export commands in this terminal, then run this script again.');
  process.exit(1);
}
for (const name of names) {
  if (!/^[A-Za-z0-9/+=]+$/.test(process.env[name])) {
    console.error(`The ${name} value has an unexpected format. Copy the current Workshop Studio export commands again.`);
    process.exit(1);
  }
}
const file = fileURLToPath(new URL('../.env.aws', import.meta.url));
writeFileSync(file, names.map(name => `${name}=${process.env[name]}`).join('\n') + '\n', { mode: 0o600 });
chmodSync(file, 0o600);
console.log('Temporary AWS session saved in the project-local, Git-ignored .env.aws file. No credentials were printed.');
console.log('These credentials still expire. Repeat this step with refreshed Workshop Studio credentials when needed.');
