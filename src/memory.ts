import { runVeloxquantJson } from './python/interpreter.js';
import type { AutoConfigResult, MemoryEstimate, MemoryEstimateInput, VeloxQuantOptions } from './types.js';

interface RawAutoConfigPayload {
  workload: { head_dim: number; seq_len: number; n_layers: number; batch_size: number };
  hardware: { total_memory_bytes: number | null; active_memory_bytes: number };
  config: Record<string, string | number>;
  reason: string;
}

function toArgs(input: MemoryEstimateInput): string[] {
  const args: string[] = [];
  if (input.headDim !== undefined) args.push('--head-dim', String(input.headDim));
  if (input.seqLen !== undefined) args.push('--seq-len', String(input.seqLen));
  if (input.nLayers !== undefined) args.push('--n-layers', String(input.nLayers));
  if (input.batchSize !== undefined) args.push('--batch-size', String(input.batchSize));
  return args;
}

function normalize(raw: RawAutoConfigPayload): AutoConfigResult {
  const { method, ...knobs } = raw.config;
  return {
    workload: {
      headDim: raw.workload.head_dim,
      seqLen: raw.workload.seq_len,
      nLayers: raw.workload.n_layers,
      batchSize: raw.workload.batch_size,
    },
    hardware: {
      totalMemoryBytes: raw.hardware.total_memory_bytes,
      activeMemoryBytes: raw.hardware.active_memory_bytes,
    },
    config: { method: String(method), headDim: Number(knobs.head_dim ?? raw.workload.head_dim), ...knobs },
    reason: raw.reason,
  };
}

/**
 * Runs `veloxquant auto-config --json` for the given workload and returns
 * the selected method/config plus the human-readable selection reason.
 * This is the same hardware-aware selector veloxquant-mlx itself uses
 * (issue #253) — not a reimplementation of its selection rules.
 */
export async function autoConfig(
  input: MemoryEstimateInput = {},
  opts: VeloxQuantOptions = {},
): Promise<AutoConfigResult> {
  const raw = await runVeloxquantJson<RawAutoConfigPayload>(['auto-config', '--json', ...toArgs(input)], opts);
  return normalize(raw);
}

/**
 * Estimates fp16 KV-cache memory for a workload and what the recommended
 * compression method would report. Compression byte counts from
 * veloxquant-mlx are accounting-only today (caches store dequantized fp16 —
 * see package issue #27): `estimatedCompressedBytes` reflects the declared
 * bit width applied to the fp16 footprint as a fidelity estimate, not a
 * measured RSS reduction. Treat it as directional, not a guarantee.
 */
export async function estimateMemory(
  input: MemoryEstimateInput = {},
  opts: VeloxQuantOptions = {},
): Promise<MemoryEstimate> {
  const result = await autoConfig(input, opts);
  const headDim = result.workload.headDim;
  const seqLen = result.workload.seqLen;
  const nLayers = result.workload.nLayers;
  const batchSize = result.workload.batchSize;

  const fp16KvCacheBytes = 2 * batchSize * nLayers * seqLen * headDim * 2;

  const bitWidth = extractBitWidth(result.config);
  const estimatedCompressedBytes = bitWidth ? Math.round(fp16KvCacheBytes * (bitWidth / 16)) : null;
  const memorySavedBytes = estimatedCompressedBytes !== null ? fp16KvCacheBytes - estimatedCompressedBytes : null;

  return {
    fp16KvCacheBytes,
    recommendedMethod: result.config.method,
    recommendedConfig: result.config,
    reason: result.reason,
    estimatedCompressedBytes,
    memorySavedBytes,
  };
}

function extractBitWidth(config: AutoConfigResult['config']): number | null {
  for (const key of ['bit_width_inlier', 'kvquant_bits', 'gear_bits', 'kivi_bits']) {
    const v = config[key];
    if (typeof v === 'number') return v;
  }
  return null;
}
