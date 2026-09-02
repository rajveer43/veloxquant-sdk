import { estimateMemory } from '../memory.js';
import { formatBytes } from './format.js';

export interface AnalyzeArgs {
  headDim?: number;
  seqLen?: number;
  nLayers?: number;
  batchSize?: number;
}

export async function runAnalyze(args: AnalyzeArgs): Promise<number> {
  try {
    const estimate = await estimateMemory(args);

    console.log('VeloxQuant memory analysis\n');
    console.log(`fp16 KV-cache: ${formatBytes(estimate.fp16KvCacheBytes)}`);
    console.log(`Recommended method: ${estimate.recommendedMethod}`);
    if (estimate.estimatedCompressedBytes !== null) {
      console.log(`Estimated compressed size: ${formatBytes(estimate.estimatedCompressedBytes)}`);
      console.log(`Estimated saved: ${formatBytes(estimate.memorySavedBytes)}`);
    }
    console.log(`\nReason: ${estimate.reason}`);
    console.log(
      '\nNote: compression byte counts are accounting-only in veloxquant-mlx today ' +
        '(caches store dequantized fp16) — treat "estimated saved" as directional fidelity, not measured RSS.',
    );
    return 0;
  } catch (err) {
    console.error(`Analysis failed: ${(err as Error).message}`);
    return 1;
  }
}
