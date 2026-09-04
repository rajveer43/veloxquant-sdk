import { startServer } from '../serve.js';
import type { LoadOptions } from '../types.js';

export interface ServeArgs {
  model?: string;
  method?: string;
  bits?: number;
  port?: number;
  host?: string;
  optimize?: boolean;
  json?: boolean;
}

/**
 * Starts `veloxquant serve` and blocks in the foreground until the process
 * is signaled to stop — mirrors `vq.load()`'s server lifecycle (same
 * startServer()/ServeHandle from src/serve.ts) but as a standalone CLI
 * command rather than something only reachable from a Node script.
 */
export async function runServe(args: ServeArgs): Promise<number> {
  if (!args.model) {
    console.error('vq serve requires --model <id>, e.g. --model mlx-community/Qwen3-4B-4bit');
    return 1;
  }

  const loadOptions: LoadOptions = {
    model: args.model,
    method: args.method,
    bits: args.bits,
    port: args.port,
    host: args.host,
    optimize: args.optimize ? 'auto' : undefined,
  };

  let handle;
  try {
    handle = await startServer(loadOptions);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  if (args.json) {
    console.log(JSON.stringify({ baseUrl: handle.baseUrl, model: handle.model, method: handle.method, pid: handle.pid }));
  } else {
    console.log(`veloxquant serve ready`);
    console.log(`  baseUrl: ${handle.baseUrl}`);
    console.log(`  model:   ${handle.model}`);
    console.log(`  method:  ${handle.method}`);
    console.log(`  pid:     ${handle.pid}`);
    console.log('\nPress Ctrl+C to stop.');
  }

  return new Promise<number>((resolve) => {
    let stopping = false;
    const shutdown = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      await handle.stop();
      resolve(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}
