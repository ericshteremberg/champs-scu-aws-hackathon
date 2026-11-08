import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const credentialNames = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];

/** @param {{ file?: string | URL, environment?: Record<string, string | undefined> }} [options] */
export function loadAwsSession({ file = new URL('../.dev.vars', import.meta.url), environment = process.env } = {}) {
  if (!existsSync(file)) return;
  const saved = parseEnv(readFileSync(file, 'utf8'));
  if (credentialNames.some(name => Object.hasOwn(saved, name))) {
    if (credentialNames.some(name => !saved[name])) throw new Error('The saved .dev.vars AWS session is incomplete. Run scripts/save-aws-session.mjs with all three current Workshop Studio credential exports.');
    // The explicitly saved session wins over an expired session inherited by this process.
    for (const name of credentialNames) environment[name] = saved[name];
  }
  // Preserve deliberate shell overrides for region, model, frontend origin, and other settings.
  for (const [name, value] of Object.entries(saved)) environment[name] ??= value;
}
