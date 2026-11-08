import { writeFileSync, chmodSync, existsSync, readFileSync, lstatSync, renameSync } from 'node:fs';
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
const file = fileURLToPath(new URL('../.dev.vars', import.meta.url));
if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Refusing to replace a symlink. Configure .dev.vars directly.');
const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
const retained = existing.split('\n').filter(line => !names.some(name => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line)));
if (!retained.some(line => /^\s*AWS_REGION\s*=/.test(line))) retained.push('AWS_REGION=us-east-1');
const temporary = `${file}.${process.pid}.tmp`;
writeFileSync(temporary, retained.concat(names.map(name => `${name}=${process.env[name]}`)).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
renameSync(temporary, file);
chmodSync(file, 0o600);
console.log('Temporary AWS session saved in Git-ignored .dev.vars. Existing configuration was preserved. No credentials were printed.');
console.log('These credentials still expire. Repeat this step with refreshed Workshop Studio credentials when needed.');
