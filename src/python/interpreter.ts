import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface InterpreterResolution {
  path: string;
  source: 'explicit' | 'env' | 'default';
}

/**
 * Resolves which Python interpreter to invoke. Order mirrors the VS Code
 * extension's precedence: an explicit override wins, then VELOXQUANT_PYTHON,
 * then a bare `python3` relying on PATH/venv activation.
 */
export function resolveInterpreter(explicitPath?: string): InterpreterResolution {
  if (explicitPath && explicitPath.trim().length > 0) {
    return { path: explicitPath, source: 'explicit' };
  }
  const fromEnv = process.env.VELOXQUANT_PYTHON;
  if (fromEnv && fromEnv.trim().length > 0) {
    return { path: fromEnv, source: 'env' };
  }
  return { path: 'python3', source: 'default' };
}

export class InterpreterInvalidError extends Error {
  constructor(public readonly interpreterPath: string, cause: unknown) {
    super(`Python interpreter at "${interpreterPath}" could not be run.`);
    this.name = 'InterpreterInvalidError';
    this.cause = cause;
  }
}

export class ModuleNotFoundInInterpreterError extends Error {
  constructor(public readonly interpreterPath: string) {
    super(
      `veloxquant_mlx is not installed in the interpreter at "${interpreterPath}". ` +
        `Install it with: ${interpreterPath} -m pip install veloxquant-mlx`,
    );
    this.name = 'ModuleNotFoundInInterpreterError';
  }
}

/** Runs `python -m veloxquant_mlx <args>` and returns parsed JSON stdout. */
export async function runVeloxquantJson<T>(
  args: string[],
  opts: { interpreterPath?: string; timeoutMs?: number } = {},
): Promise<T> {
  const { path: interpreterPath } = resolveInterpreter(opts.interpreterPath);
  let stdout: string;
  try {
    const result = await execFileAsync(interpreterPath, ['-m', 'veloxquant_mlx', ...args], {
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    const execErr = err as { code?: string | number; stderr?: string; message?: string };
    const stderr = execErr.stderr ?? '';
    if (/ModuleNotFoundError.*veloxquant_mlx/.test(stderr)) {
      throw new ModuleNotFoundInInterpreterError(interpreterPath);
    }
    if (execErr.code === 'ENOENT') {
      throw new InterpreterInvalidError(interpreterPath, err);
    }
    throw new Error(
      `veloxquant_mlx ${args.join(' ')} exited with an error: ${stderr || execErr.message || String(err)}`,
    );
  }

  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(
      `veloxquant_mlx ${args.join(' ')} did not return valid JSON on stdout: ${(err as Error).message}`,
    );
  }
}

/** Runs `python -c "import veloxquant_mlx; print(veloxquant_mlx.__version__)"`. */
export async function getInstalledVersion(interpreterPath?: string): Promise<string | null> {
  const { path } = resolveInterpreter(interpreterPath);
  try {
    const { stdout } = await execFileAsync(
      path,
      ['-c', 'import veloxquant_mlx; print(veloxquant_mlx.__version__)'],
      { timeout: 10_000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
