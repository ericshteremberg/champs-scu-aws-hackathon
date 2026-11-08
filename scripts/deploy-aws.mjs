import {readFileSync,writeFileSync} from 'node:fs';
import {CloudFormationClient,CreateStackCommand,UpdateStackCommand,DescribeStacksCommand,DescribeStackEventsCommand} from '@aws-sdk/client-cloudformation';
import {LambdaClient,UpdateFunctionCodeCommand,waitUntilFunctionUpdated} from '@aws-sdk/client-lambda';
import {loadAwsSession} from './load-aws-session.mjs';
loadAwsSession();
const region=process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
if(region!=='us-east-1')throw new Error('This hackathon deployment uses us-east-1.');
const stackName='causality-hackathon-dev';
const cloudformation=new CloudFormationClient({region});
let existing;
try{existing=(await cloudformation.send(new DescribeStacksCommand({StackName:stackName}))).Stacks?.[0];}catch(error){if(error.name!=='ValidationError')throw error;}
if(existing && existing.StackStatus?.includes('IN_PROGRESS'))throw new Error('The AWS stack is already updating. Wait for it to finish.');
const params={StackName:stackName,TemplateBody:readFileSync('infra/aws-backend.json','utf8'),Capabilities:['CAPABILITY_IAM'],Parameters:[{ParameterKey:'FrontendOrigin',...(process.env.CAUSALITY_FRONTEND_ORIGIN?{ParameterValue:process.env.CAUSALITY_FRONTEND_ORIGIN}:existing?{UsePreviousValue:true}:{ParameterValue:'https://not-configured.example.invalid'})},{ParameterKey:'BedrockModelId',ParameterValue:process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-opus-5'}]};
const providerRegistration=JSON.parse(readFileSync('integrations/oauth/supabase-registration.json','utf8'));
params.Parameters.push({ParameterKey:'SupabaseOAuthSecretArn',ParameterValue:process.env.SUPABASE_OAUTH_SECRET_ARN || providerRegistration.secretArn});
const stripeRegistration=JSON.parse(readFileSync('integrations/oauth/stripe-secret-location.json','utf8'));
params.Parameters.push({ParameterKey:'StripeOAuthSecretArn',ParameterValue:process.env.STRIPE_OAUTH_SECRET_ARN || stripeRegistration.arn});
for (const [ParameterKey, envName] of [['ResendSecretArn','RESEND_SECRET_ARN'],['ResendWorkspaceId','RESEND_WORKSPACE_ID'],['ResendAllowedDomains','RESEND_ALLOWED_DOMAINS']]) {
 const prior = existing?.Parameters?.some(p => p.ParameterKey === ParameterKey);
 params.Parameters.push({ParameterKey,...(process.env[envName] ? {ParameterValue:process.env[envName]} : prior ? {UsePreviousValue:true} : {ParameterValue:''})});
}
const gmailRegistration=JSON.parse(readFileSync('integrations/oauth/gmail-registration.json','utf8'));
const gmailSecretArn=process.env.GMAIL_OAUTH_SECRET_ARN || gmailRegistration.secretArn;
params.Parameters.push({ParameterKey:'GmailOAuthSecretArn',...(gmailSecretArn ? {ParameterValue:gmailSecretArn} : existing?.Parameters?.some(p=>p.ParameterKey==='GmailOAuthSecretArn') ? {UsePreviousValue:true} : {ParameterValue:''})});
let changed=true;
try{await cloudformation.send(existing?new UpdateStackCommand(params):new CreateStackCommand(params));}catch(error){if(error.name==='ValidationError' && error.message.includes('No updates'))changed=false;else throw error;}
let stack,lastStatus='';
for(let attempt=0;attempt<160;attempt++){
 stack=(await cloudformation.send(new DescribeStacksCommand({StackName:stackName}))).Stacks?.[0];
 if(stack?.StackStatus!==lastStatus){lastStatus=stack?.StackStatus;console.log(`AWS stack: ${lastStatus}`);}
 if(!stack?.StackStatus?.includes('IN_PROGRESS'))break;
 await new Promise(resolve=>setTimeout(resolve,3000));
}
if(!['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(stack?.StackStatus)){
 const events=(await cloudformation.send(new DescribeStackEventsCommand({StackName:stackName}))).StackEvents||[];
 console.error(events.filter(event=>event.ResourceStatus?.includes('FAILED')).map(event=>({resource:event.LogicalResourceId,reason:event.ResourceStatusReason})));
 throw new Error('The AWS stack did not complete successfully.');
}
const outputs=Object.fromEntries(stack.Outputs.map(value=>[value.OutputKey,value.OutputValue]));
writeFileSync('.aws-build/deployment.json',JSON.stringify({region,...outputs},null,2)+'\n');
console.log(JSON.stringify({resourcesReady:true,...outputs}));
if(!process.argv.includes('--resources-only')){
 const code=readFileSync('.aws-build/backend.zip');
 const lambda=new LambdaClient({region});
 for(const FunctionName of [outputs.FunctionName,outputs.InvestigatorFunctionName,...(outputs.ResendWebhookUrl?['causality-resend-webhook']:[])]) {
  await lambda.send(new UpdateFunctionCodeCommand({FunctionName,ZipFile:code}));
  await waitUntilFunctionUpdated({client:lambda,maxWaitTime:120,minDelay:2,maxDelay:5},{FunctionName});
 }
 console.log('AWS Lambda code uploaded.');
}
