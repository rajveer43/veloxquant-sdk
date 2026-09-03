/**
 * Using @veloxquant/sdk/ai-sdk with the Vercel AI SDK's generateText()/
 * streamText() against a locally served model.
 *
 * Usage:
 *   npm install ai @ai-sdk/openai-compatible
 *   npx tsx examples/ai-sdk.ts
 */
import { generateText, streamText } from 'ai';
import { veloxquant } from '../src/ai-sdk.js';
import { VeloxQuant } from '../src/index.js';

const MODEL = 'mlx-community/Llama-3.2-1B-Instruct-4bit';

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  // veloxquant() takes an already-loaded model, not a bare model name: it
  // needs a running server's baseUrl, and the caller stays responsible for
  // stopping it — see the doc comment on veloxquant() for why.
  const model = await vq.load({ model: MODEL, optimize: 'auto' });

  try {
    const result = await generateText({
      model: veloxquant(model),
      prompt: 'Say hello in exactly three words.',
    });
    console.log(result.text);

    const stream = streamText({
      model: veloxquant(model),
      prompt: 'Count from 1 to 5.',
    });
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }
    console.log();
  } finally {
    await model.stop();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
