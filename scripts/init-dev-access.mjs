import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const path=new URL('../.dev-worker-access.txt',import.meta.url);
if(existsSync(path))console.log('The private development access file already exists. Its password was preserved.');
else {
 writeFileSync(path,`Causality development Worker\nUsername: dev\nPassword: ${randomBytes(32).toString('base64url')}\nURL: https://causality-hackathon-dev.slidah60.workers.dev\nShare this password privately. It must never be committed to Git.\n`,{mode:0o600,flag:'wx'});
 console.log('Created the ignored private development access file. Syncing it to Wrangler will set the deployment password.');
}
