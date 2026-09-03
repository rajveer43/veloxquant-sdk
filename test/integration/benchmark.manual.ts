/**
 * Manual integration check for benchmark() — NOT run by `npm test`.
 *
 * Requires real Apple Silicon hardware, veloxquant-mlx installed, and the
 * model downloaded locally. CI runners have none of these, so this lives
 * outside test/unit and is excluded from the "*.test.ts" pattern `npm test`
 * runs.
 *
 * Usage:
 *   npx tsx test/integration/benchmark.manual.ts
 */
import assert from 'node:assert/strict';
import { benchmark } from '../../src/index.js';

async function main(): Promise<void> {
  const result = await benchmark({
    model: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
    maxTokens: 64,
  });

  assert.ok(result.tokensPerSecond > 0, 'expected tokensPerSecond > 0');
  assert.ok(result.timeToFirstTokenMs > 0, 'expected timeToFirstTokenMs > 0');
  assert.ok(result.chip, 'expected chip to be detected');
  assert.equal(result.model, 'mlx-community/Llama-3.2-1B-Instruct-4bit');

  const markdown = result.toMarkdown();
  assert.match(markdown, /VeloxQuant Benchmark/);
  assert.match(markdown, /Tokens\/sec: [\d.]+/);
  assert.match(markdown, /TTFT: \d+ms/);

  console.log('PASS');
  console.log(markdown);
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exitCode = 1;
});
