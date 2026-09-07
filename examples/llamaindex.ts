/**
 * LlamaIndex.TS adapter. Wraps an already-vq.load()ed VeloxQuantModel as a
 * LlamaIndex.TS LLM, usable with chat(), streaming chat(), and complete().
 *
 * Usage:
 *   npx tsx examples/llamaindex.ts
 */
import { VeloxQuant } from '../src/index.js';
import { VeloxQuantLLM } from '../src/llamaindex.js';

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  const model = await vq.load({ model: 'mlx-community/Qwen3-4B-4bit', optimize: 'auto' });

  try {
    const llm = new VeloxQuantLLM(model);

    const response = await llm.chat({
      messages: [{ role: 'user', content: "What's the capital of France?" }],
    });
    console.log('chat():', response.message.content);

    process.stdout.write('stream chat(): ');
    const stream = await llm.chat({
      messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }],
      stream: true,
    });
    for await (const chunk of stream) process.stdout.write(chunk.delta);
    console.log();

    const completion = await llm.complete({ prompt: 'The capital of Japan is' });
    console.log('complete():', completion.text);
  } finally {
    await model.stop();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
