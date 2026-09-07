import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteLocalModel, pullLocalModel } from '../../src/localModels.js';

/**
 * These tests run a real `python3 -c` snippet (huggingface_hub must be
 * importable) rather than mocking execFile, matching how listLocalModels()
 * is implicitly exercised elsewhere in this codebase — there's no existing
 * execFile-mocking convention to follow instead. Every test points HF_HOME
 * at a fresh, empty temp directory via a scoped env override so nothing
 * here can ever read or touch the developer's real Hugging Face cache.
 */
function withIsolatedHfHome<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vq-hf-home-'));
  const prev = process.env.HF_HOME;
  process.env.HF_HOME = dir;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.HF_HOME;
    else process.env.HF_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  });
}

test('deleteLocalModel: deleting a model not in the cache throws a clear, specific error', async () => {
  await withIsolatedHfHome(async () => {
    await assert.rejects(
      () => deleteLocalModel('mlx-community/does-not-exist-in-this-empty-cache'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /No cached model found with id/);
        assert.match(err.message, /does-not-exist-in-this-empty-cache/);
        return true;
      },
    );
  });
});

test('deleteLocalModel: a model id containing shell metacharacters is passed as a single argv element, not interpreted as shell syntax', async () => {
  await withIsolatedHfHome(async () => {
    const maliciousId = '; touch /tmp/vq-test-pwned; echo pwned';
    await assert.rejects(
      () => deleteLocalModel(maliciousId),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        // The id round-trips verbatim into the error message (via sys.argv[1]
        // in Python, not shell-expanded) rather than being split into
        // separate shell commands.
        assert.match(err.message, /No cached model found with id/);
        assert.ok(err.message.includes(maliciousId));
        return true;
      },
    );
  });
});

test('pullLocalModel: a model id containing shell metacharacters is rejected as an invalid repo id, not executed as shell syntax', async () => {
  await withIsolatedHfHome(async () => {
    const maliciousId = '; touch /tmp/vq-test-pwned; echo pwned';
    await assert.rejects(
      () => pullLocalModel(maliciousId, { timeoutMs: 20_000 }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Failed to pull model/);
        return true;
      },
    );
  });
});

