import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { loadAwsSession } from './load-aws-session.mjs';

loadAwsSession();
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const modelId = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-opus-5';

try {
  if (region !== 'us-east-1') throw new Error('Use us-east-1 for the SCU workshop environment.');
  const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  console.log(`AWS session verified in ${region}. Account ends in ${identity.Account?.slice(-4) || 'unknown'}.`);
  console.log(`Configured model: ${modelId}`);
  if (process.argv.includes('--invoke')) {
    const response = await new BedrockRuntimeClient({ region }).send(new ConverseCommand({
      modelId,
      messages: [{ role: 'user', content: [{ text: 'This is a synthetic connectivity test. Call lookup_status for case_id test_case to answer whether the test case is ready. Do not answer without the tool.' }] }],
      inferenceConfig: { maxTokens: 256 },
      ...(modelId.endsWith('anthropic.claude-opus-5') ? { additionalModelRequestFields: { thinking: { type: 'disabled' } } } : {}),
      toolConfig: { tools: [{ toolSpec: {
        name: 'lookup_status', description: 'Get the status of a synthetic test case.',
        inputSchema: { json: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'], additionalProperties: false } },
      } }] },
    }), { abortSignal: AbortSignal.timeout(30000) });
    if (!response.output?.message?.content?.some(block => block.toolUse?.name === 'lookup_status')) {
      throw new Error('The model responded without the requested tool call. Select a model that supports Converse tool use.');
    }
    console.log('Bedrock Converse tool call verified. No customer records were sent.');
  } else {
    console.log('To verify model access with one small synthetic request: npm run aws:check -- --invoke');
  }
} catch (error) {
  const name = error instanceof Error ? error.name : 'Error';
  const localMessage = error instanceof Error && error.name === 'Error' ? error.message : undefined;
  console.error(localMessage || `AWS check failed (${name}). Check your Workshop Studio session, region, and model access. No credentials were printed.`);
  console.error('Setup: https://github.com/SCUACM/aws-access-26/tree/main/1-setup');
  process.exitCode = 1;
}
