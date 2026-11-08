import {build} from 'esbuild';
import {mkdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
mkdirSync('.aws-build',{recursive:true});
await build({entryPoints:['aws/handler.ts'],bundle:true,platform:'node',target:'node22',format:'cjs',outfile:'.aws-build/index.js',minify:true,logLevel:'warning'});
rmSync('.aws-build/backend.zip',{force:true});
const zipped=spawnSync('zip',['-q','backend.zip','index.js'],{cwd:'.aws-build',stdio:'inherit'});
if(zipped.status!==0)throw new Error('Could not create Lambda deployment archive.');
console.log('Built the private AWS Lambda backend.');
