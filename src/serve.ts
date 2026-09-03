import { spawn } from 'node:child_process';
import * as net from 'node:net';
import { resolveInterpreter } from './python/interpreter.js';
import type { LoadOptions, ServeHandle, VeloxQuantOptions } from './types.js';

const READY_PREFIX = 'VELOXQUANT_READY ';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not allocate a free port')));
      }
    });
  });
}

/**
 * Spawns `python -m veloxquant_mlx serve --model ... --method ...` and
 * resolves once the process prints the VELOXQUANT_READY stdout handshake
 * (veloxquant_mlx/cli/serve.py) — distinguishing "still loading the model"
 * from "listening," which a bare port-open check cannot do for a slow load.
 */
export async function startServer(
  options: LoadOptions,
  opts: VeloxQuantOptions = {},
): Promise<ServeHandle> {
  const { path: interpreterPath } = resolveInterpreter(opts.pythonPath);
  const port = options.port ?? (await findFreePort());
  const host = options.host ?? '127.0.0.1';

  const args = ['-m', 'veloxquant_mlx', 'serve', '--model', options.model, '--host', host, '--port', String(port)];
  if (options.method) args.push('--method', options.method);
  if (options.bits !== undefined) args.push('--bits', String(options.bits));

  const child = spawn(interpreterPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const method = options.method ?? 'turboquant_rvq';

  return new Promise<ServeHandle>((resolve, reject) => {
    let stderrBuf = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`veloxquant serve did not become ready within 120s for model "${options.model}".`));
    }, 120_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (settled) return;
      if (text.includes(READY_PREFIX)) {
        settled = true;
        clearTimeout(timeout);
        resolve({
          baseUrl: `http://${host}:${port}`,
          model: options.model,
          method,
          port,
          pid: child.pid ?? -1,
          stop: async () => {
            child.kill('SIGTERM');
          },
        });
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `veloxquant serve exited with code ${code} before becoming ready.\n${stderrBuf.trim()}`,
        ),
      );
    });
  });
}
