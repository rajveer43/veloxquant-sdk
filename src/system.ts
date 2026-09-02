import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import { getInstalledVersion, resolveInterpreter } from './python/interpreter.js';
import type { SystemInfo, VeloxQuantOptions } from './types.js';

const execFileAsync = promisify(execFile);

const DETECT_HARDWARE_SNIPPET = `
import json
try:
    from veloxquant_mlx.config import detect_hardware_info
    hw = detect_hardware_info()
    print(json.dumps({"total": hw.total_memory_bytes, "active": hw.active_memory_bytes}))
except Exception:
    print(json.dumps({"total": None, "active": 0}))
`.trim();

async function detectChip(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('sysctl', ['-n', 'machdep.cpu.brand_string']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Detects the local machine's hardware and VeloxQuant-MLX install state.
 * Node's os.totalmem()/os.freemem() give a Node-side fallback; when
 * veloxquant_mlx is importable, detect_hardware_info() (backed by
 * mx.device_info()) is preferred for unified-memory accuracy on Apple Silicon.
 */
export async function getSystemInfo(opts: VeloxQuantOptions = {}): Promise<SystemInfo> {
  const { path: interpreterPath } = resolveInterpreter(opts.pythonPath);
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';

  const [chip, version] = await Promise.all([detectChip(), getInstalledVersion(opts.pythonPath)]);

  let unifiedMemoryBytes: number = os.totalmem();
  let availableMemoryBytes: number = os.freemem();

  if (version) {
    try {
      const { stdout } = await execFileAsync(interpreterPath, ['-c', DETECT_HARDWARE_SNIPPET], {
        timeout: opts.timeoutMs ?? 10_000,
      });
      const parsed = JSON.parse(stdout) as { total: number | null; active: number };
      if (parsed.total) {
        unifiedMemoryBytes = parsed.total;
        availableMemoryBytes = Math.max(parsed.total - parsed.active, 0);
      }
    } catch {
      // Fall back to the os.* values already assigned above.
    }
  }

  return {
    platform: process.platform,
    isAppleSilicon,
    chip,
    unifiedMemoryBytes,
    availableMemoryBytes,
    veloxquantInstalled: version !== null,
    veloxquantVersion: version,
    pythonInterpreter: interpreterPath,
  };
}
