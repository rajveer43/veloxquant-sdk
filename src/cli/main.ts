import { runDoctor } from './doctor.js';
import { runAnalyze } from './analyze.js';
import { runRecommend } from './recommend.js';

function parseIntArg(argv: string[], flag: string): number | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const value = Number(argv[idx + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function printHelp(): void {
  console.log(`veloxquant — JS/TS CLI for veloxquant-mlx

Usage:
  vq doctor                    Check that veloxquant-mlx is installed and ready
  vq recommend                 Show detected hardware and servable methods
  vq analyze [options]         Estimate KV-cache memory for a workload

Analyze options:
  --head-dim <n>    Attention head dimension (default: 128)
  --seq-len <n>     Sequence length in tokens (default: 4096)
  --n-layers <n>    Number of layers (default: 1)
  --batch-size <n>  Batch size (default: 1)
`);
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case 'doctor':
      return runDoctor();
    case 'recommend':
      return runRecommend();
    case 'analyze':
      return runAnalyze({
        headDim: parseIntArg(rest, '--head-dim'),
        seqLen: parseIntArg(rest, '--seq-len'),
        nLayers: parseIntArg(rest, '--n-layers'),
        batchSize: parseIntArg(rest, '--batch-size'),
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
