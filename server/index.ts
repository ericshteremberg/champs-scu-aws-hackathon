import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

if (existsSync('.env')) process.loadEnvFile('.env');
if (existsSync('.env.aws')) process.loadEnvFile('.env.aws');
const config = loadConfig();
const workspace = createApp(config);
const server = workspace.app.listen(config.port, config.host, () => {
  console.log(`Casework API listening on http://${config.host}:${config.port} (${config.mode} mode)`);
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await workspace.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
