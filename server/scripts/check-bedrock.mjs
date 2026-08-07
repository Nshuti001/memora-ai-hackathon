/**
 * Quick probe: can this account invoke Claude Sonnet 4.6 and Titan embeddings?
 *   node scripts/check-bedrock.mjs
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const region = process.env.AWS_REGION || 'us-east-1';
const model = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6';
const embedModel = process.env.BEDROCK_EMBED_MODEL_ID || 'amazon.titan-embed-text-v2:0';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!accessKeyId || !secretAccessKey) {
  console.error('Missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in server/.env');
  process.exit(1);
}

console.log(`region=${region}`);
console.log(`model=${model}`);
console.log(`embed=${embedModel}`);

const claude = new AnthropicBedrock({
  awsRegion: region,
  awsAccessKey: accessKeyId,
  awsSecretKey: secretAccessKey,
});

try {
  const msg = await claude.messages.create({
    model,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
  });
  const text = msg.content?.filter((b) => b.type === 'text').map((b) => b.text).join('');
  console.log('Claude: OK —', text);
} catch (err) {
  console.log('Claude: FAIL —', (err.message || String(err)).slice(0, 200));
  if (/tokens per day/i.test(err.message || '')) {
    console.log(`
This is an AWS account quota, not a Memora bug.
New accounts often ship with Bedrock on-demand tokens-per-day at 0.

Fix (use root / admin console):
  1. Open https://console.aws.amazon.com/servicequotas/home/services/bedrock/quotas
  2. Search "tokens per day" / "On-demand" for Anthropic Claude Sonnet
  3. Request an increase (even 50_000 TPD is enough for the hackathon)
  4. Or open a free Basic Support case: https://support.console.aws.amazon.com/support/home#/case/create
     Subject: Bedrock ThrottlingException Too many tokens per day on new account
`);
  }
}

const titan = new BedrockRuntimeClient({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

try {
  const out = await titan.send(
    new InvokeModelCommand({
      modelId: embedModel,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText: 'quota check', dimensions: 1024, normalize: true }),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(out.body));
  console.log('Titan:  OK —', parsed.embedding?.length, 'dims');
} catch (err) {
  console.log('Titan:  FAIL —', err.name, (err.message || '').slice(0, 120));
}
