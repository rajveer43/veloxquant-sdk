/**
 * Multi-turn conversation helper: Conversation bookkeeps ChatMessage history
 * automatically so callers don't have to hand-roll it and re-append after
 * every turn.
 *
 * Usage:
 *   npx tsx examples/conversation.ts
 */
import { VeloxQuant } from '../src/index.js';

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  const model = await vq.load({ model: 'mlx-community/Qwen3-4B-4bit', optimize: 'auto' });

  try {
    const convo = model.conversation({ system: 'You are a terse assistant.' });

    const r1 = await convo.send("What's the capital of France?");
    console.log('Assistant:', r1.text);

    const r2 = await convo.send('And its population?');
    console.log('Assistant:', r2.text);

    console.log('\nFull history:', JSON.stringify(convo.messages, null, 2));

    convo.reset();
    console.log('\nAfter reset():', JSON.stringify(convo.messages, null, 2));
  } finally {
    await model.stop();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
