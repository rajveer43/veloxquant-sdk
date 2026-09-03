import { getSystemInfo } from './system.js';
import { autoConfig, estimateMemory } from './memory.js';
import { recommend } from './recommend.js';
import { listMethods } from './methods.js';
import { optimize } from './optimize.js';
import { startServer } from './serve.js';
import { chatCompletion, chatStream } from './chat.js';
import type {
  ChatInput,
  ChatResponse,
  LoadOptions,
  MemoryEstimate,
  MemoryEstimateInput,
  MethodsResult,
  OptimizeInput,
  OptimizeResult,
  RecommendInput,
  RecommendResult,
  ServeHandle,
  StreamChunk,
  SystemInfo,
  VeloxQuantOptions,
} from './types.js';

/**
 * A loaded model handle: a running `veloxquant serve` process plus the
 * chat()/stream() methods that talk to it over its OpenAI-compatible API.
 * Returned by VeloxQuant.load(). Call stop() when done to free the port
 * and terminate the subprocess.
 */
export class VeloxQuantModel {
  constructor(private readonly handle: ServeHandle) {}

  get baseUrl(): string {
    return this.handle.baseUrl;
  }

  get method(): string {
    return this.handle.method;
  }

  get pid(): number {
    return this.handle.pid;
  }

  async chat(input: Omit<ChatInput, 'model'> & { model?: string }): Promise<ChatResponse> {
    return chatCompletion(this.handle, { ...input, model: input.model ?? this.handle.model });
  }

  stream(input: Omit<ChatInput, 'model'> & { model?: string }): AsyncGenerator<StreamChunk> {
    return chatStream(this.handle, { ...input, model: input.model ?? this.handle.model });
  }

  async stop(): Promise<void> {
    await this.handle.stop();
  }
}

/**
 * Top-level SDK client. Every method shells out to the local `veloxquant`
 * (veloxquant-mlx) CLI or talks HTTP to a `veloxquant serve` subprocess it
 * manages — there is no reimplementation of quantization or hardware
 * detection logic in JS; this is a typed bridge, per the "don't duplicate
 * the Python engine" architecture decision.
 */
export class VeloxQuant {
  private readonly options: VeloxQuantOptions;
  private activeServers: ServeHandle[] = [];

  constructor(options: VeloxQuantOptions = {}) {
    this.options = options;
  }

  readonly system = {
    info: (): Promise<SystemInfo> => getSystemInfo(this.options),
  };

  readonly memory = {
    estimate: (input: MemoryEstimateInput = {}): Promise<MemoryEstimate> => estimateMemory(input, this.options),
    autoConfig: (input: MemoryEstimateInput = {}) => autoConfig(input, this.options),
  };

  readonly models = {
    list: (filter: { servableOnly?: boolean; family?: string } = {}): Promise<MethodsResult> =>
      listMethods(filter, this.options),
  };

  async recommendModel(input: RecommendInput): Promise<RecommendResult> {
    return recommend(input, this.options);
  }

  async optimize(input: OptimizeInput = {}): Promise<OptimizeResult> {
    return optimize(input, this.options);
  }

  /** Spawns `veloxquant serve` for the given model and returns a handle with chat()/stream(). */
  async load(loadOptions: LoadOptions): Promise<VeloxQuantModel> {
    let method = loadOptions.method;
    let bits = loadOptions.bits;

    if (loadOptions.optimize === 'auto') {
      const picked = await optimize(
        { seqLen: loadOptions.seqLen, nLayers: loadOptions.nLayers },
        this.options,
      );
      method = method ?? picked.config.method;
      bits =
        bits ??
        (typeof picked.config.bit_width_inlier === 'number'
          ? picked.config.bit_width_inlier
          : typeof picked.config.kvquant_bits === 'number'
            ? picked.config.kvquant_bits
            : typeof picked.config.gear_bits === 'number'
              ? picked.config.gear_bits
              : undefined);
    }

    const handle = await startServer({ ...loadOptions, method, bits }, this.options);
    this.activeServers.push(handle);
    return new VeloxQuantModel(handle);
  }

  /** Convenience one-shot: load a model, send one chat request, stop the server. */
  async chat(input: ChatInput): Promise<ChatResponse> {
    const model = await this.load({ model: input.model, optimize: 'auto' });
    try {
      return await model.chat(input);
    } finally {
      await model.stop();
    }
  }

  /** Convenience one-shot streaming: load a model, stream one response, stop the server after. */
  async *stream(input: ChatInput): AsyncGenerator<StreamChunk> {
    const model = await this.load({ model: input.model, optimize: 'auto' });
    try {
      yield* model.stream(input);
    } finally {
      await model.stop();
    }
  }

  /** Stops every server this client has started that is still running. */
  async dispose(): Promise<void> {
    await Promise.all(this.activeServers.map((s) => s.stop()));
    this.activeServers = [];
  }
}
