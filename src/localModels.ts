import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveInterpreter } from './python/interpreter.js';
import type { DeleteModelResult, LocalModel, PullModelResult, VeloxQuantOptions } from './types.js';
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
    from huggingface_hub.errors import CacheNotFound
except ImportError:
    print(json.dumps({"error": "huggingface_hub is not importable"}))
else:
    try:
        info = scan_cache_dir()
    except CacheNotFound:
        print(json.dumps({"repos": []}))
    else:
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

/**
 * Downloads a model's weights into the local Hugging Face cache via
 * `snapshot_download()` — the same library `listLocalModels()` reads back
 * from — without loading it into MLX or starting a `veloxquant serve`
 * process. Model id is passed as its own argv element (see execFileAsync
 * call below), never interpolated into a shell string, so an id containing
 * shell metacharacters can't be interpreted as shell syntax.
 *
 * No progress callback: `snapshot_download()`'s tqdm-based progress reporting
 * doesn't cross the `python -c` stdout boundary cleanly, and a partial
 * per-file progress protocol isn't worth building for a v1. Downloads can
 * take many minutes for large models, so this deliberately does NOT reuse
 * VeloxQuantOptions.timeoutMs's 30s CLI default — callers get an
 * unbounded wait unless they pass `timeoutMs` explicitly.
 */
export async function pullLocalModel(
  modelId: string,
  opts: VeloxQuantOptions = {},
): Promise<PullModelResult> {
  const { path: interpreterPath } = resolveInterpreter(opts.pythonPath);

  const snippet = `
import json, sys
try:
    from huggingface_hub import snapshot_download, scan_cache_dir
    from huggingface_hub.errors import CacheNotFound
except ImportError:
    print(json.dumps({"error": "huggingface_hub is not importable"}))
else:
    model_id = sys.argv[1]
    try:
        snapshot_download(repo_id=model_id)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
    else:
        try:
            info = scan_cache_dir()
        except CacheNotFound:
            size_bytes = 0
        else:
            repo = next((r for r in info.repos if r.repo_type == "model" and r.repo_id == model_id), None)
            size_bytes = repo.size_on_disk if repo is not None else 0
        print(json.dumps({"id": model_id, "size_bytes": size_bytes}))
`.trim();

  let stdout: string;
  try {
    const result = await execFileAsync(interpreterPath, ['-c', snippet, modelId], {
      timeout: opts.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    const execErr = err as { stderr?: string; message?: string };
    throw new Error(`Failed to pull model "${modelId}": ${execErr.stderr || execErr.message || String(err)}`);
  }

  const parsed = JSON.parse(stdout) as { id?: string; size_bytes?: number; error?: string };
  if (parsed.error) {
    throw new Error(`Failed to pull model "${modelId}": ${parsed.error}`);
  }

  return { id: parsed.id ?? modelId, sizeBytes: parsed.size_bytes ?? 0 };
}

/**
 * Deletes a model's weights from the local Hugging Face cache using
 * huggingface_hub's own eviction API (scan → delete_revisions → execute)
 * rather than an `rm -rf` on a resolved path: the cache's blob layout is
 * content-addressed and shared across revisions/repos via symlinks (the
 * same reason listLocalModels() above uses scan_cache_dir() instead of a
 * hand-rolled `du`), so a naive recursive delete risks corrupting a
 * *different* cached model's blobs.
 */
export async function deleteLocalModel(
  modelId: string,
  opts: VeloxQuantOptions = {},
): Promise<DeleteModelResult> {
  const { path: interpreterPath } = resolveInterpreter(opts.pythonPath);

  const snippet = `
import json, sys
try:
    from huggingface_hub import scan_cache_dir
    from huggingface_hub.errors import CacheNotFound
except ImportError:
    print(json.dumps({"error": "huggingface_hub is not importable"}))
else:
    model_id = sys.argv[1]
    try:
        info = scan_cache_dir()
    except CacheNotFound:
        print(json.dumps({"error": f"No cached model found with id {model_id!r}"}))
    else:
        repo = next((r for r in info.repos if r.repo_type == "model" and r.repo_id == model_id), None)
        if repo is None:
            print(json.dumps({"error": f"No cached model found with id {model_id!r}"}))
        else:
            revisions = [rev.commit_hash for rev in repo.revisions]
            strategy = info.delete_revisions(*revisions)
            strategy.execute()
            print(json.dumps({"id": model_id, "freed_bytes": strategy.expected_freed_size}))
`.trim();

  let stdout: string;
  try {
    const result = await execFileAsync(interpreterPath, ['-c', snippet, modelId], {
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    const execErr = err as { stderr?: string; message?: string };
    throw new Error(`Failed to delete model "${modelId}": ${execErr.stderr || execErr.message || String(err)}`);
  }

  const parsed = JSON.parse(stdout) as { id?: string; freed_bytes?: number; error?: string };
  if (parsed.error) {
    throw new Error(`Failed to delete model "${modelId}": ${parsed.error}`);
  }

  return { id: parsed.id ?? modelId, freedBytes: parsed.freed_bytes ?? 0 };
}
