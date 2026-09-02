import { getSystemInfo } from '../system.js';
import { listMethods } from '../methods.js';
import { recommend } from '../recommend.js';
import { formatBytes } from './format.js';
import type { Goal, ModelClass } from '../types.js';

export interface RecommendArgs {
  json?: boolean;
  modelClass?: ModelClass;
  goal?: Goal;
}

/**
 * There is no hardware-only "recommend a model" CLI in veloxquant-mlx today
 * — `veloxquant recommend` recommends a *compression method* for a chip/RAM/
 * model-class/goal combination the caller already knows. With no
 * --model-class/--goal given, this command reports detected hardware plus
 * the servable method list so a user gets a concrete next step without
 * inventing a model catalog the package doesn't provide. When both are
 * given, it delegates to recommendModel() for a full recommendation
 * (chip/ramGb auto-detected) instead of duplicating that logic here.
 */
export async function runRecommend(args: RecommendArgs = {}): Promise<number> {
  if (args.modelClass && args.goal) {
    try {
      const result = await recommend({ modelClass: args.modelClass, goal: args.goal });
      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return 0;
      }
      console.log(`Recommended method: ${result.recommendation.method}`);
      console.log(`Rationale: ${result.recommendation.rationale}`);
      if (result.recommendation.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const w of result.recommendation.warnings) console.log(`  - ${w}`);
      }
      return 0;
    } catch (err) {
      if (args.json) {
        console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
      } else {
        console.error(`Recommendation failed: ${(err as Error).message}`);
      }
      return 1;
    }
  }

  const [info, methods] = await Promise.all([getSystemInfo(), listMethods({ servableOnly: true }).catch(() => null)]);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          chip: info.chip,
          unifiedMemoryBytes: info.unifiedMemoryBytes,
          availableMemoryBytes: info.availableMemoryBytes,
          veloxquantInstalled: info.veloxquantInstalled,
          defaultServeMethod: methods?.defaultServeMethod ?? null,
          servableMethods: methods?.methods ?? [],
        },
        null,
        2,
      ),
    );
    return info.veloxquantInstalled ? 0 : 1;
  }

  console.log('Your machine\n');
  console.log(`Chip: ${info.chip ?? 'unknown'}`);
  console.log(`Unified memory: ${formatBytes(info.unifiedMemoryBytes)}`);
  console.log(`Available memory: ${formatBytes(info.availableMemoryBytes)}`);

  if (!info.veloxquantInstalled) {
    console.log('\nveloxquant-mlx is not installed — run `vq doctor` for setup instructions.');
    return 1;
  }

  if (methods && methods.methods.length > 0) {
    console.log(`\nServable KV-cache methods (default: ${methods.defaultServeMethod}):`);
    for (const m of methods.methods.slice(0, 8)) {
      console.log(`  ${m.name.padEnd(18)} ${m.family.padEnd(13)} ${m.serveTierLabel}`);
    }
  }

  console.log(
    '\nNext step: run `vq analyze --seq-len <N>` with your expected context length ' +
      'for a hardware-aware compression recommendation, or pass --model-class and --goal ' +
      'for a full recommendation.',
  );
  return 0;
}
