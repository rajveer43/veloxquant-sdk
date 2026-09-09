import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline';
import { resolveInterpreter } from './interpreter.js';

export interface WorkerOptions { interpreterPath?: string; timeoutMs?: number }
export interface WorkerResponse<T = unknown> { protocol_version: number; id: string; ok: boolean; result?: T; error?: string | { code: string; message: string } }
export interface MetalProbeResult { device: string; output: number[]; passed: boolean }
export interface WorkerCapabilities { veloxquantVersion: string; mlxVersion: string | null; device: string; metalAvailable: boolean; supportedOperations: string[] }
export interface BitPackResult { bits: 1 | 2 | 4; inputLength: number; values: number[]; backend: string; device: string }
export interface BitPackFileResult { outputPath: string; shape: [number]; dtype: 'uint8'; inputLength: number; bits: 1 | 2 | 4; backend: string; device: string }
export interface RopeRecodeFileResult { outputPath: string; shape: [number, number, number]; dtype: string; backend: string; device: string }
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export function decodeWorkerResponse(line: string): WorkerResponse {
  const response = JSON.parse(line) as WorkerResponse;
  if (response.protocol_version !== 1 || !response.id || typeof response.ok !== 'boolean') throw new Error('invalid veloxquant worker response');
  return response;
}

export class VeloxQuantWorker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;
  private closed = false;

  constructor(options: WorkerOptions = {}) {
    const interpreter = resolveInterpreter(options.interpreterPath).path;
    this.child = spawn(interpreter, ['-m', 'veloxquant_mlx', 'worker'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = createInterface({ input: this.child.stdout });
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.lines.on('line', (line) => this.onLine(line));
    this.child.on('error', (error) => this.failAll(error));
    this.child.on('exit', (code) => this.failAll(new Error(`veloxquant worker exited with code ${code ?? 'unknown'}`)));
  }

  private onLine(line: string): void {
    let response: WorkerResponse;
    try { response = decodeWorkerResponse(line); } catch { return; }
    const item = this.pending.get(response.id);
    if (!item) return;
    clearTimeout(item.timer); this.pending.delete(response.id);
    if (response.ok) item.resolve(response.result);
    else item.reject(new Error(typeof response.error === 'string' ? response.error : response.error?.message ?? 'veloxquant worker request failed'));
  }

  private failAll(error: Error): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }

  request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.closed || this.child.stdin.destroyed) return Promise.reject(new Error('veloxquant worker is closed'));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`worker request timed out: ${op}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, op, args })}\n`);
    });
  }

  ping(): Promise<{ version: string }> { return this.request('ping'); }
  capabilities(): Promise<WorkerCapabilities> { return this.request('capabilities'); }
  metalProbe(): Promise<MetalProbeResult> { return this.request('metal_probe'); }
  bitPack(values: number[], bits: 1 | 2 | 4): Promise<BitPackResult> { return this.request('bit_pack', { values, bits }); }
  bitPackFile(inputPath: string, outputPath: string, bits: 1 | 2 | 4): Promise<BitPackFileResult> {
    return this.request('bit_pack_file', { inputPath, outputPath, bits });
  }
  ropeRecodeFile(inputPath: string, positionsPath: string, outputPath: string, sourceBase: number, targetBase: number): Promise<RopeRecodeFileResult> {
    return this.request('rope_recode_file', { inputPath, positionsPath, outputPath, sourceBase, targetBase });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try { await this.request('shutdown'); } catch { /* process may already be gone */ }
    this.closed = true; this.lines.close(); this.child.kill();
  }
}

export function startWorker(options: WorkerOptions = {}): VeloxQuantWorker { return new VeloxQuantWorker(options); }
