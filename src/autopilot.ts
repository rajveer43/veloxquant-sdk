import { recommend } from './recommend.js';
import { listMethods } from './methods.js';
import { optimize } from './optimize.js';
import { VeloxQuant, VeloxQuantModel } from './client.js';
import type { Chip, Goal, ModelClass, RamGb, VeloxQuantOptions } from './types.js';

/**
 * Substring match against `recommend()`'s warning prose to detect a
 * genuine "this will not fit" case, as opposed to routine accounting-only
 * caveats (which appear even on perfectly healthy configs — see the
 * "Compression byte counts are accounting-only" note in the README).
 * There is no structured severity field in veloxquant-mlx's `recommend`
 * output today (verified against 0.71.1), so this is best-effort: it
 * depends on the Python package's warning wording staying stable. If this
 * starts silently failing to catch real OOM warnings after a
 * veloxquant-mlx upgrade, that's a sign the phrasing changed upstream —
 * check `recommendation.warnings` directly rather than trusting this
 * heuristic blindly.
 */
export const WONT_FIT_PATTERN = /will not fit|short of any headroom/i;

export interface AutopilotInput {
  model: string;
  modelClass: ModelClass;
  goal?: Goal;
  /** Overrides auto-detected hardware — mainly useful for testing or recommending for a different target machine. */
  chip?: Chip;
  ramGb?: RamGb;
  /** Proceed even if recommend() reports the config likely won't fit. Default false. */
  force?: boolean;
}

export class AutopilotFitError extends Error {
  constructor(public readonly warnings: string[]) {
    super(
      `veloxquant recommend reports this configuration likely will not fit:\n` +
        warnings.map((w) => `  - ${w}`).join('\n') +
        '\n\nPass `force: true` to autopilot() to start the server anyway.',
    );
    this.name = 'AutopilotFitError';
  }
}

/**
 * Loaded model handle returned by autopilot(), identical to VeloxQuantModel
 * plus the warnings (if any) that recommend() reported for the chosen config.
 */
export class AutopilotSession {
  constructor(
    private readonly model: VeloxQuantModel,
    public readonly warnings: string[],
  ) {}

  get baseUrl(): string {
    return this.model.baseUrl;
  }

  get method(): string {
    return this.model.method;
  }

  chat: VeloxQuantModel['chat'] = (input) => this.model.chat(input);
  stream: VeloxQuantModel['stream'] = (input) => this.model.stream(input);

  async stop(): Promise<void> {
    await this.model.stop();
  }
}

/**
 * Gets a hardware-aware recommendation for `modelClass`/`goal` (chip/ramGb
 * auto-detected), refuses to start a server for a config recommend() says
 * likely won't fit (unless `force: true`), then loads `model`. Thin
 * composition over recommendModel() + load() — does not pick or know about
 * specific LLMs (veloxquant-mlx has no model catalog to select from; `model`
 * must be supplied by the caller).
 *
 * `recommend()`'s picked method is not guaranteed to be servable — it also
 * returns compression-only methods (e.g. `rabitq`) that `veloxquant serve`
 * rejects. When that happens, autopilot() falls back to `optimize()` (which
 * only selects from `auto-config`'s serve-safe choices) for the actual
 * method/bit-width, while still using recommend()'s warnings for the fit
 * check above — recommend() remains the source of truth for "does this
 * fit," optimize() for "what can serve() actually run."
 */
export async function autopilot(input: AutopilotInput, opts: VeloxQuantOptions = {}): Promise<AutopilotSession> {
  const result = await recommend(
    { modelClass: input.modelClass, goal: input.goal ?? 'everyday', chip: input.chip, ramGb: input.ramGb },
    opts,
  );

  const warnings = result.recommendation.warnings;
  const wontFit = warnings.filter((w) => WONT_FIT_PATTERN.test(w));
  if (wontFit.length > 0 && !input.force) {
    throw new AutopilotFitError(wontFit);
  }

  const servable = await listMethods({ servableOnly: true }, opts);
  const servableNames = new Set(servable.methods.map((m) => m.name));

  let method = result.recommendation.method;
  let bits = extractBitWidth(result.recommendation.knobs);

  if (!servableNames.has(method)) {
    const picked = await optimize({}, opts);
    method = picked.config.method;
    bits = extractBitWidth(picked.config as unknown as Record<string, number>);
  }

  const vq = new VeloxQuant(opts);
  const model = await vq.load({ model: input.model, method, bits });

  return new AutopilotSession(model, warnings);
}

export function extractBitWidth(knobs: Record<string, number>): number | undefined {
  for (const key of ['bit_width_inlier', 'kvquant_bits', 'gear_bits', 'kivi_bits']) {
    const v = knobs[key];
    if (typeof v === 'number') return v;
  }
  return undefined;
}
