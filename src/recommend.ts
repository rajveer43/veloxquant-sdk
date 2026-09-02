import { runVeloxquantJson } from './python/interpreter.js';
import type { RecommendInput, RecommendResult, VeloxQuantOptions } from './types.js';

/**
 * Chip/RAM/model-class choices mirror `veloxquant recommend`'s argparse
 * definition as of veloxquant-mlx 0.71.1: chips M1-M4 (no M5 yet), RAM
 * tiers up to 128GB (no 192/256/512GB yet). Passing a value outside these
 * sets will fail against the installed CLI with argparse's own error —
 * this SDK does not silently widen or narrow what the package supports.
 */
export const SUPPORTED_CHIPS = ['M1', 'M2', 'M3', 'M4'] as const;
export const SUPPORTED_RAM_GB = [8, 16, 24, 32, 36, 48, 64, 128] as const;

function toArgs(input: RecommendInput): string[] {
  const args = [
    '--chip', input.chip,
    '--ram-gb', String(input.ramGb),
    '--model-class', input.modelClass,
    '--goal', input.goal,
  ];
  if (input.seqLen !== undefined) args.push('--seq-len', String(input.seqLen));
  if (input.nLayers !== undefined) args.push('--n-layers', String(input.nLayers));
  if (input.nKvHeads !== undefined) args.push('--n-kv-heads', String(input.nKvHeads));
  if (input.headDim !== undefined) args.push('--head-dim', String(input.headDim));
  return args;
}

interface RawRecommendPayload {
  request: {
    chip: string;
    ram_gb: number;
    model_class: string;
    goal: string;
    seq_len: number;
    n_layers: number;
    n_kv_heads: number;
    head_dim: number;
  };
  recommendation: {
    method: string;
    knobs: Record<string, number>;
    key_accounting_ratio: number;
    resident_savings_likely: boolean;
    kv_fp16_mb: number;
    kv_compressed_mb_estimate: number;
    warnings: string[];
    rationale: string;
  };
}

/** Runs `veloxquant recommend --json` for a given chip/RAM/model/goal combination. */
export async function recommend(input: RecommendInput, opts: VeloxQuantOptions = {}): Promise<RecommendResult> {
  const raw = await runVeloxquantJson<RawRecommendPayload>(['recommend', '--json', ...toArgs(input)], opts);
  return {
    request: {
      chip: raw.request.chip as RecommendInput['chip'],
      ramGb: raw.request.ram_gb as RecommendInput['ramGb'],
      modelClass: raw.request.model_class as RecommendInput['modelClass'],
      goal: raw.request.goal as RecommendInput['goal'],
      seqLen: raw.request.seq_len,
      nLayers: raw.request.n_layers,
      nKvHeads: raw.request.n_kv_heads,
      headDim: raw.request.head_dim,
    },
    recommendation: {
      method: raw.recommendation.method,
      knobs: raw.recommendation.knobs,
      keyAccountingRatio: raw.recommendation.key_accounting_ratio,
      residentSavingsLikely: raw.recommendation.resident_savings_likely,
      kvFp16Mb: raw.recommendation.kv_fp16_mb,
      kvCompressedMbEstimate: raw.recommendation.kv_compressed_mb_estimate,
      warnings: raw.recommendation.warnings,
      rationale: raw.recommendation.rationale,
    },
  };
}
