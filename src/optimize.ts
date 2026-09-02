import { autoConfig } from './memory.js';
import type { OptimizeInput, OptimizeProfile, OptimizeResult, VeloxQuantOptions } from './types.js';

/**
 * Profiles bias the workload passed to `veloxquant auto-config` rather than
 * reimplementing its selection rules. auto-config's own logic already keys
 * off seq_len (short/mid/long context bands) and memory pressure
 * (config/auto_config.py) — a profile is just "which band do you want to
 * land in," expressed by nudging seq_len before delegating.
 */
const PROFILE_SEQ_LEN_MULTIPLIER: Record<OptimizeProfile, number> = {
  speed: 0.5, // biases toward the short-context band (higher precision, less compression overhead)
  balanced: 1, // no bias — use the workload's real seq_len
  memory: 4, // biases toward the long-context band (aggressive compression)
  'maximum-context': 8, // strongly biases toward the long-context band
};

/**
 * Picks a KV-cache compression config for a workload, biased by a named
 * profile. This is the "one-line optimization" entry point: callers who
 * don't want to think in seq_len bands pick "speed" / "balanced" / "memory"
 * / "maximum-context" instead.
 */
export async function optimize(
  input: OptimizeInput = {},
  opts: VeloxQuantOptions = {},
): Promise<OptimizeResult> {
  const profile = input.profile ?? 'balanced';
  const baseSeqLen = input.seqLen ?? 4096;
  const biasedSeqLen = Math.max(1, Math.round(baseSeqLen * PROFILE_SEQ_LEN_MULTIPLIER[profile]));

  const result = await autoConfig(
    {
      headDim: input.headDim,
      seqLen: biasedSeqLen,
      nLayers: input.nLayers,
      batchSize: input.batchSize,
    },
    opts,
  );

  return {
    ...result,
    workload: { ...result.workload, seqLen: baseSeqLen },
    profile,
  };
}
