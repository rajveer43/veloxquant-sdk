import { runDoctor } from './doctor.js';
import { runAnalyze } from './analyze.js';
import { runRecommend } from './recommend.js';
import type { Goal, ModelClass } from '../types.js';

function parseIntArg(argv: string[], flag: string): number | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const value = Number(argv[idx + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseStringArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function printHelp(): void {
  console.log(`veloxquant — JS/TS CLI for veloxquant-mlx

Usage:
  vq doctor                    Check that veloxquant-mlx is installed and ready
  vq recommend [options]       Show detected hardware and servable methods
  vq analyze [options]         Estimate KV-cache memory for a workload

All commands accept --json for machine-readable output.

Recommend options (both required together for a full recommendation):
  --model-class <class>  1B | 3B | 7B | 14B | 32B
  --goal <goal>          everyday | max_key_accounting | max_context | best_quality | constant_memory

Analyze options:
  --head-dim <n>    Attention head dimension (default: 128)
  --seq-len <n>     Sequence length in tokens (default: 4096)
  --n-layers <n>    Number of layers (default: 1)
  --batch-size <n>  Batch size (default: 1)
`);
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const json = hasFlag(rest, '--json');

  switch (command) {
    case 'doctor':
      return runDoctor({ json });
    case 'recommend':
      return runRecommend({
        json,
        modelClass: parseStringArg(rest, '--model-class') as ModelClass | undefined,
        goal: parseStringArg(rest, '--goal') as Goal | undefined,
      });
    case 'analyze':
      return runAnalyze({
        headDim: parseIntArg(rest, '--head-dim'),
        seqLen: parseIntArg(rest, '--seq-len'),
        nLayers: parseIntArg(rest, '--n-layers'),
        batchSize: parseIntArg(rest, '--batch-size'),
        json,
      });
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      return 1;
  }
}
