import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveInterpreter } from './python/interpreter.js';
import type { LocalModel, VeloxQuantOptions } from './types.js';
export type { LocalModel } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Uses huggingface_hub's own cache scanner rather than walking the cache
 * directory by hand: the on-disk layout is content-addressed via symlinks
 * (blobs shared across revisions), so a naive per-file `du` would double
 * count. scan_cache_dir() already resolves this and honors HF_HOME /
 * HF_HUB_CACHE internally, so no path-resolution logic is duplicated here.
 * huggingface_hub isn't a direct dependency of veloxquant-mlx, but is a
 * transitive one via mlx_lm/transformers — anywhere `veloxquant serve` can
 * actually load a HF model id, it's importable.
 */
const SCAN_CACHE_SNIPPET = `
import json
try:
    from huggingface_hub import scan_cache_dir
except ImportError:
    print(json.dumps({"error": "huggingface_hub is not importable"}))
else:
    info = scan_cache_dir()
    repos = [
        {
            "id": repo.repo_id,
            "size_bytes": repo.size_on_disk,
            "last_accessed": repo.last_accessed,
        }
        for repo in info.repos
        if repo.repo_type == "model"
    ]
    print(json.dumps({"repos": repos}))
`.trim();

interface RawLocalModel {
  id: string;
  size_bytes: number;
  last_accessed: number | null;
}

/**
 * Lists model weights already downloaded to the local Hugging Face cache
 * (read-only — no deletion/pull support here). Distinct from
 * `vq.models.list()`, which lists the *compression methods* registry, not
 * downloaded weights.
 */
export async function listLocalModels(opts: VeloxQuantOptions = {}): Promise<LocalModel[]> {
  const { path: interpreterPath } = resolveInterpreter(opts.pythonPath);

  let stdout: string;
  try {
    const result = await execFileAsync(interpreterPath, ['-c', SCAN_CACHE_SNIPPET], {
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    const execErr = err as { stderr?: string; message?: string };
    throw new Error(
      `Failed to scan the local Hugging Face cache: ${execErr.stderr || execErr.message || String(err)}`,
    );
  }

  const parsed = JSON.parse(stdout) as { repos?: RawLocalModel[]; error?: string };
  if (parsed.error) {
    throw new Error(`Failed to scan the local Hugging Face cache: ${parsed.error}`);
  }

  return (parsed.repos ?? []).map((repo) => ({
    id: repo.id,
    sizeBytes: repo.size_bytes,
    lastUsedAt: repo.last_accessed ? new Date(repo.last_accessed * 1000) : null,
  }));
}
