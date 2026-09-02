import { getSystemInfo } from './system.js';
import { runVeloxquantJson } from './python/interpreter.js';
import type { Chip, RamGb, RecommendInput, RecommendResult, VeloxQuantOptions } from './types.js';

/**
 * Chip/RAM/model-class choices mirror `veloxquant recommend`'s argparse
 * definition as of veloxquant-mlx 0.71.1: chips M1-M4 (no M5 yet), RAM
 * tiers up to 128GB (no 192/256/512GB yet). Passing a value outside these
 * sets will fail against the installed CLI with argparse's own error —
 * this SDK does not silently widen or narrow what the package supports.
 */
export const SUPPORTED_CHIPS = ['M1', 'M2', 'M3', 'M4'] as const;
export const SUPPORTED_RAM_GB = [8, 16, 24, 32, 36, 48, 64, 128] as const;

/**
 * Maps the raw `sysctl machdep.cpu.brand_string` value (e.g. "Apple M4 Pro")
 * returned by system.info()'s chip detection to one of SUPPORTED_CHIPS.
 * Throws rather than guessing when the detected chip isn't one `veloxquant
 * recommend` has argparse choices for (e.g. an M5, or non-Apple-Silicon).
 */
export function normalizeChip(rawChip: string | null): Chip {
  if (!rawChip) {
    throw new Error(
      'Could not detect an Apple Silicon chip on this machine. Pass `chip` explicitly to recommendModel().',
    );
  }
  const match = SUPPORTED_CHIPS.find((c) => rawChip.includes(c));
  if (!match) {
    throw new Error(
      `Detected chip "${rawChip}" is not one of the chips veloxquant recommend supports ` +
        `(${SUPPORTED_CHIPS.join(', ')}). Pass \`chip\` explicitly to recommendModel().`,
    );
  }
  return match;
}

/**
 * Rounds detected unified memory down to the nearest SUPPORTED_RAM_GB tier.
 * Rounds down (never up) so a recommendation is never sized for more RAM
 * than is actually present. Throws if the machine has less than the
 * smallest supported tier rather than silently clamping upward.
 */
export function normalizeRamGb(unifiedMemoryBytes: number | null): RamGb {
  if (!unifiedMemoryBytes) {
    throw new Error('Could not detect unified memory on this machine. Pass `ramGb` explicitly to recommendModel().');
  }
  const detectedGb = unifiedMemoryBytes / 1024 ** 3;
  const tiers = [...SUPPORTED_RAM_GB].sort((a, b) => b - a);
  const match = tiers.find((tier) => tier <= detectedGb);
  if (match === undefined) {
    throw new Error(
      `Detected ${detectedGb.toFixed(1)}GB of unified memory, below the smallest tier ` +
        `veloxquant recommend supports (${SUPPORTED_RAM_GB[0]}GB). Pass \`ramGb\` explicitly to recommendModel().`,
    );
  }
  return match;
}

function toArgs(chip: Chip, ramGb: RamGb, input: RecommendInput): string[] {
  const args = [
    '--chip', chip,
    '--ram-gb', String(ramGb),
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

/**
 * Runs `veloxquant recommend --json` for a given chip/RAM/model/goal
 * combination. `chip`/`ramGb` are auto-detected from this machine (via
 * system.info()) when omitted.
 */
export async function recommend(input: RecommendInput, opts: VeloxQuantOptions = {}): Promise<RecommendResult> {
  let chip = input.chip;
  let ramGb = input.ramGb;
  if (chip === undefined || ramGb === undefined) {
    const info = await getSystemInfo(opts);
    chip = chip ?? normalizeChip(info.chip);
    ramGb = ramGb ?? normalizeRamGb(info.unifiedMemoryBytes);
  }

  const raw = await runVeloxquantJson<RawRecommendPayload>(['recommend', '--json', ...toArgs(chip, ramGb, input)], opts);
  return {
    request: {
      chip: raw.request.chip as Chip,
      ramGb: raw.request.ram_gb as RamGb,
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
