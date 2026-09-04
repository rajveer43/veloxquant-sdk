/**
 * Lists model weights already downloaded to this machine's Hugging Face
 * cache. Read-only — see vq.models.list() (src/methods.ts) for the separate
 * *compression methods* registry, which is not about downloaded weights.
 *
 * Usage:
 *   npx tsx examples/local-models.ts
 */
import { VeloxQuant } from '../src/index.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function main(): Promise<void> {
  const vq = new VeloxQuant();
  const local = await vq.models.local();

  if (local.length === 0) {
    console.log('No models found in the local Hugging Face cache.');
    return;
  }

  for (const m of local) {
    const lastUsed = m.lastUsedAt ? m.lastUsedAt.toISOString() : 'unknown';
    console.log(`${m.id.padEnd(40)} ${formatBytes(m.sizeBytes).padStart(10)}   last used ${lastUsed}`);
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
