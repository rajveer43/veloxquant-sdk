/**
 * Standalone "will this fit in my Mac's memory" calculator.
 *
 * Usage:
 *   npx tsx examples/memory-estimate.ts --seq-len 32768 --head-dim 128 --n-layers 32
 *
 * All flags are optional (see estimateMemory()'s defaults in src/memory.ts).
 */
import { estimateMemory, formatBytes } from '../src/index.js';

function parseIntArg(argv: string[], flag: string): number | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const value = Number(argv[idx + 1]);
  return Number.isFinite(value) ? value : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const input = {
    headDim: parseIntArg(argv, '--head-dim'),
    seqLen: parseIntArg(argv, '--seq-len'),
    nLayers: parseIntArg(argv, '--n-layers'),
    batchSize: parseIntArg(argv, '--batch-size'),
  };

  const estimate = await estimateMemory(input);

  console.log(`fp16 KV-cache:        ${formatBytes(estimate.fp16KvCacheBytes)}`);
  console.log(`Recommended method:   ${estimate.recommendedMethod}`);
  if (estimate.estimatedCompressedBytes !== null) {
    console.log(`Estimated compressed: ${formatBytes(estimate.estimatedCompressedBytes)}`);
    console.log(`Estimated saved:      ${formatBytes(estimate.memorySavedBytes)}`);
  }
  console.log(`\nReason: ${estimate.reason}`);
  console.log(
    '\nNote: compression byte counts are accounting-only today (caches store dequantized ' +
      'fp16) — treat "estimated saved" as directional, not a measured RSS reduction.',
  );
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
