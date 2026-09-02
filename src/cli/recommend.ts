import { getSystemInfo } from '../system.js';
import { listMethods } from '../methods.js';
import { formatBytes } from './format.js';

/**
 * There is no hardware-only "recommend a model" CLI in veloxquant-mlx today
 * — `veloxquant recommend` recommends a *compression method* for a chip/RAM/
 * model-class/goal combination the caller already knows. This command
 * reports detected hardware plus the servable method list so a user gets a
 * concrete next step (`vq analyze --seq-len ...`) without inventing a model
 * catalog the package doesn't provide.
 */
export async function runRecommend(): Promise<number> {
  const [info, methods] = await Promise.all([getSystemInfo(), listMethods({ servableOnly: true }).catch(() => null)]);

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
      'for a hardware-aware compression recommendation.',
  );
  return 0;
}
