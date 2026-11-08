import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './sites-env.mjs';

const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
function execute(command) {
 const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--json','--command',command],{cwd:projectRoot,encoding:'utf8'});
 if(result.status!==0) throw new Error(result.stderr || result.stdout || 'Local migration failed.');
 return JSON.parse(result.stdout);
}
execute('CREATE TABLE IF NOT EXISTS causality_local_migrations (tag text PRIMARY KEY NOT NULL)');
const applied=new Set(execute('SELECT tag FROM causality_local_migrations').flatMap(r=>r.results).map(r=>r.tag));
const tables=execute("SELECT name FROM sqlite_master WHERE type='table'").flatMap(r=>r.results).map(r=>r.name);
for(const migration of journal.entries) {
 const tag=migration.tag;
 if(!/^\d{4}_[a-z0-9_]+$/.test(tag)) throw new Error('Unexpected migration tag.');
 if(applied.has(tag)) continue;
 // Adopt the documented initial migration if it was already applied manually.
 if(tag==='0000_fluffy_hardball' && tables.includes('workspaces')) {
  execute(`INSERT INTO causality_local_migrations(tag) VALUES ('${tag}')`);
  console.log(`Already present: ${tag}`);
  continue;
 }
 const sql=readFileSync(new URL(`../drizzle/${tag}.sql`,import.meta.url),'utf8');
 execute(`${sql}\nINSERT INTO causality_local_migrations(tag) VALUES ('${tag}');`);
 console.log(`Applied: ${tag}`);
}
console.log('Local D1 migrations are current.');
