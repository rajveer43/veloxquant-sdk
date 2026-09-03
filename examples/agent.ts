/**
 * Single-turn tool-calling agent, using the model's native tool-calling
 * support (confirmed working against mlx-community/Qwen3-4B-4bit — not
 * every model's tokenizer supports this; check `has_tool_calling` if a
 * model you try doesn't call tools as expected).
 *
 * Usage:
 *   npx tsx examples/agent.ts
 */
import { VeloxQuant } from '../src/index.js';

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  const agent = await vq.agent({ model: 'mlx-community/Qwen3-4B-4bit', optimize: 'auto' });

  agent.tool({
    name: 'get_weather',
    description: 'Get the current weather for a location',
    parameters: {
      type: 'object',
      properties: { location: { type: 'string', description: 'City name' } },
      required: ['location'],
    },
    execute: async ({ location }: { location: string }) => {
      // A real tool would call a weather API here.
      return { location, tempC: 22, condition: 'sunny' };
    },
  });

  try {
    const result = await agent.run(
      'What is the weather in Tokyo? Use the get_weather tool, then tell me if I need an umbrella.',
    );
    console.log(result.text);
    console.log('\nSteps taken:', JSON.stringify(result.steps, null, 2));
  } finally {
    await agent.stop();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
