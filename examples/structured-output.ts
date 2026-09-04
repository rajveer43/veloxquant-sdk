/**
 * Structured output / JSON mode via `responseFormat`. Not backed by
 * grammar-constrained decoding — mlx_lm's server doesn't natively support
 * `response_format` (see issue #14 investigation), so this is a best-effort
 * prompt-injection fallback: formatting instructions get appended to the
 * outgoing messages, and the response text is parsed as JSON afterward,
 * throwing a descriptive error (not a raw JSON.parse SyntaxError) if the
 * model's output doesn't parse.
 *
 * Usage:
 *   npx tsx examples/structured-output.ts
 */
import { VeloxQuant } from '../src/index.js';

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  const model = await vq.load({ model: 'mlx-community/Qwen3-4B-4bit', optimize: 'auto' });

  try {
    const result = await model.chat({
      messages: [{ role: 'user', content: 'Extract the name and age from: John is 30.' }],
      responseFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'number' } },
          required: ['name', 'age'],
        },
      },
    });

    console.log('Raw text:', result.text);
    console.log('Parsed JSON:', result.json);
  } finally {
    await model.stop();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
