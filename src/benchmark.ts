import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSystemInfo } from './system.js';
import { VeloxQuant } from './client.js';
import type { VeloxQuantOptions } from './types.js';

const execFileAsync = promisify(execFile);

const BENCHMARK_PROMPT = 'Write a three-sentence summary of how photosynthesis works.';
const DEFAULT_MAX_TOKENS = 128;

export interface BenchmarkInput {
  model: string;
  /** Compression method to compare against the default. Defaults to "auto" (optimize: "auto"). */
  optimizedMethod?: string;
  maxTokens?: number;
}

export interface BenchmarkResult {
  model: string;
  chip: string | null;
  unifiedMemoryBytes: number | null;
  tokensPerSecond: number;
  timeToFirstTokenMs: number;
  /**
   * Measured resident memory (RSS) of the `veloxquant serve` subprocess,
   * sampled once right after the model finishes loading — NOT the
   * accounting-only byte counts `vq.memory.estimate()` reports (see the
   * "Compression byte counts are accounting-only" note in the README).
   * This is real, measured memory, but it reflects idle model-load RSS, not
   * KV-cache growth under load — and compression is not guaranteed to
   * lower it: it can measure smaller in accounting terms while resident
   * memory stays flat or even increases (verified: kivi measured higher
   * idle RSS than the default method against a 1B model in practice).
   */
  defaultMethodResidentBytes: number | null;
  optimizedResidentBytes: number | null;
  method: string;
  optimizedMethodUsed: string;
  toMarkdown(): string;
}

/** Reads RSS (bytes) for a PID via `ps`. Returns null if the process has already exited or ps fails. */
async function getResidentBytes(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
    const kb = parseInt(stdout.trim(), 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

/**
 * Times a single generation against an already-loaded model, measuring
 * tokens/sec and time-to-first-token at the SDK boundary (chunk arrival
 * timestamps from stream()) — no new instrumentation added to
 * `veloxquant serve` itself, per the "measure at the SDK boundary" design.
 */
async function timeGeneration(
  model: { stream(input: { prompt: string; maxTokens?: number }): AsyncGenerator<{ text: string; done: boolean }> },
  maxTokens: number,
): Promise<{ tokensPerSecond: number; timeToFirstTokenMs: number }> {
  const start = performance.now();
  let firstTokenAt: number | null = null;
  let tokenCount = 0;

  for await (const chunk of model.stream({ prompt: BENCHMARK_PROMPT, maxTokens })) {
    if (chunk.done) break;
    if (chunk.text.length === 0) continue;
    if (firstTokenAt === null) firstTokenAt = performance.now();
    tokenCount += 1;
  }

  const end = performance.now();
  const timeToFirstTokenMs = firstTokenAt !== null ? firstTokenAt - start : end - start;
  const generationSeconds = (end - (firstTokenAt ?? start)) / 1000;
  const tokensPerSecond = generationSeconds > 0 ? tokenCount / generationSeconds : 0;

  return { tokensPerSecond, timeToFirstTokenMs };
}

export function buildMarkdown(result: Omit<BenchmarkResult, 'toMarkdown'>): string {
  const lines = [
    'VeloxQuant Benchmark',
    '',
    `Model: ${result.model}`,
    `Machine: ${result.chip ?? 'unknown'}`,
    result.unifiedMemoryBytes ? `RAM: ${(result.unifiedMemoryBytes / 1024 ** 3).toFixed(0)}GB` : null,
    '',
    `Tokens/sec: ${result.tokensPerSecond.toFixed(1)}`,
    `TTFT: ${result.timeToFirstTokenMs.toFixed(0)}ms`,
    '',
  ];

  if (result.defaultMethodResidentBytes !== null && result.optimizedResidentBytes !== null) {
    const beforeMb = result.defaultMethodResidentBytes / 1024 ** 2;
    const afterMb = result.optimizedResidentBytes / 1024 ** 2;
    const deltaPercent = ((beforeMb - afterMb) / beforeMb) * 100;
    lines.push(
      `${result.method} resident memory: ${beforeMb.toFixed(0)}MB`,
      `${result.optimizedMethodUsed} resident memory: ${afterMb.toFixed(0)}MB`,
      deltaPercent >= 0
        ? `Resident memory reduced: ${deltaPercent.toFixed(0)}%`
        : `Resident memory increased: ${Math.abs(deltaPercent).toFixed(0)}% (compression is accounting-only — see README)`,
    );
  }

  return lines.filter((l): l is string => l !== null).join('\n');
}

/**
 * Benchmarks tokens/sec, TTFT, and measured resident memory for `model` on
 * this machine, comparing the default serve method against an
 * optimize()-picked (or explicitly named) method. Loads two separate server
 * processes sequentially (not concurrently, to avoid resource contention
 * skewing the timing) and tears each down when done.
 *
 * Requires real Apple Silicon hardware and a downloaded model — this is not
 * unit-testable in CI (see test/integration/benchmark.manual.ts).
 */
export async function benchmark(input: BenchmarkInput, opts: VeloxQuantOptions = {}): Promise<BenchmarkResult> {
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const info = await getSystemInfo(opts);

  const vq = new VeloxQuant(opts);

  const defaultModel = await vq.load({ model: input.model, optimize: false });
  let defaultMethodResidentBytes: number | null = null;
  let timing: { tokensPerSecond: number; timeToFirstTokenMs: number };
  try {
    defaultMethodResidentBytes = await getResidentBytes(defaultModel.pid);
    timing = await timeGeneration(defaultModel, maxTokens);
  } finally {
    await defaultModel.stop();
  }

  const optimizedModel = await vq.load({
    model: input.model,
    method: input.optimizedMethod,
    optimize: input.optimizedMethod ? false : 'auto',
  });
  let optimizedResidentBytes: number | null = null;
  try {
    optimizedResidentBytes = await getResidentBytes(optimizedModel.pid);
  } finally {
    await optimizedModel.stop();
  }

  const result: Omit<BenchmarkResult, 'toMarkdown'> = {
    model: input.model,
    chip: info.chip,
    unifiedMemoryBytes: info.unifiedMemoryBytes,
    tokensPerSecond: timing.tokensPerSecond,
    timeToFirstTokenMs: timing.timeToFirstTokenMs,
    defaultMethodResidentBytes,
    optimizedResidentBytes,
    method: defaultModel.method,
    optimizedMethodUsed: optimizedModel.method,
  };

  return { ...result, toMarkdown: () => buildMarkdown(result) };
}
