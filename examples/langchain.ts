/**
 * LangChain.js adapter. Wraps an already-vq.load()ed VeloxQuantModel as a
 * LangChain.js BaseChatModel, usable with invoke() and LCEL chains.
 *
 * Streaming (`_streamResponseChunks`) is not implemented in this adapter —
 * invoke() and LCEL chains work, but `.stream()` buffers the full result
 * rather than truly streaming tokens.
 *
 * Usage:
 *   npx tsx examples/langchain.ts
 */
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { VeloxQuant } from '../src/index.js';
import { VeloxQuantChatModel } from '../src/langchain.js';

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  const model = await vq.load({ model: 'mlx-community/Qwen3-4B-4bit', optimize: 'auto' });

  try {
    const chatModel = new VeloxQuantChatModel(model);

    const direct = await chatModel.invoke('Explain quantum computing in one sentence.');
    console.log('Direct invoke():', direct.content);

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'You are a terse assistant. Answer in one short sentence.'],
      ['human', '{question}'],
    ]);
    const chain = prompt.pipe(chatModel).pipe(new StringOutputParser());
    const chained = await chain.invoke({ question: "What's the capital of France?" });
    console.log('LCEL chain:', chained);
  } finally {
    await model.stop();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
