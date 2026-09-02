/**
 * Using the real `openai` npm package against a server started by
 * vq.load() — no wrapper class needed, veloxquant serve is already
 * OpenAI-compatible at the HTTP level.
 *
 * Usage:
 *   npm install openai
 *   npx tsx examples/openai-client.ts
 */
import OpenAI from 'openai';
import { VeloxQuant } from '../src/index.js';

const MODEL = 'mlx-community/Llama-3.2-1B-Instruct-4bit';

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  const model = await vq.load({ model: MODEL, optimize: 'auto' });

  try {
    // baseURL must end in "/v1" — the openai client appends "/chat/completions"
    // itself. `model` in each request must be the actual served model id, not
    // model.method (that's the KV-cache compression method name, e.g. "kivi" —
    // passing it as `model` gets rejected with a 404 by the running server).
    const client = new OpenAI({ baseURL: `${model.baseUrl}/v1`, apiKey: 'local' });

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Say hello in exactly three words.' }],
    });
    console.log(response.choices[0]?.message?.content);

    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
      stream: true,
    });
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
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
