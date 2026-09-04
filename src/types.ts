export interface VeloxQuantOptions {
  /** Explicit Python interpreter path. Falls back to VELOXQUANT_PYTHON, then "python3". */
  pythonPath?: string;
  /** Timeout in ms for one-shot CLI calls (system.info, memory.estimate, ...). Default 30_000. */
  timeoutMs?: number;
}

export interface HardwareInfo {
  totalMemoryBytes: number | null;
  activeMemoryBytes: number;
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  isAppleSilicon: boolean;
  chip: string | null;
  unifiedMemoryBytes: number | null;
  availableMemoryBytes: number | null;
  veloxquantInstalled: boolean;
  veloxquantVersion: string | null;
  pythonInterpreter: string;
}

export interface WorkloadSpecInput {
  headDim?: number;
  seqLen?: number;
  nLayers?: number;
  batchSize?: number;
}

export interface AutoConfigConfig {
  method: string;
  headDim: number;
  [knob: string]: string | number;
}

export interface AutoConfigResult {
  workload: Required<WorkloadSpecInput>;
  hardware: HardwareInfo;
  config: AutoConfigConfig;
  reason: string;
}

export interface MemoryEstimateInput {
  headDim?: number;
  seqLen?: number;
  nLayers?: number;
  batchSize?: number;
}

export interface MemoryEstimate {
  fp16KvCacheBytes: number;
  recommendedMethod: string;
  recommendedConfig: AutoConfigConfig;
  reason: string;
  /** Estimated bytes if the model were served with the recommended method's declared bit width, accounting-only (see veloxquant-mlx issue #27: caches store dequantized fp16, so this is a fidelity estimate, not measured RSS). */
  estimatedCompressedBytes: number | null;
  memorySavedBytes: number | null;
}

export type Chip = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
export type RamGb = 8 | 16 | 24 | 32 | 36 | 48 | 64 | 128;
export type ModelClass = '1B' | '3B' | '7B' | '14B' | '32B';
export type Goal = 'everyday' | 'max_key_accounting' | 'max_context' | 'best_quality' | 'constant_memory';

export interface RecommendInput {
  /** Defaults to the detected chip (via system.info()) when omitted. */
  chip?: Chip;
  /** Defaults to the detected unified memory, rounded down to the nearest supported tier, when omitted. */
  ramGb?: RamGb;
  modelClass: ModelClass;
  goal: Goal;
  seqLen?: number;
  nLayers?: number;
  nKvHeads?: number;
  headDim?: number;
}

export interface RecommendResult {
  request: {
    chip: Chip;
    ramGb: RamGb;
    modelClass: ModelClass;
    goal: Goal;
    seqLen: number;
    nLayers: number;
    nKvHeads: number;
    headDim: number;
  };
  recommendation: {
    method: string;
    knobs: Record<string, number>;
    keyAccountingRatio: number;
    residentSavingsLikely: boolean;
    kvFp16Mb: number;
    kvCompressedMbEstimate: number;
    warnings: string[];
    rationale: string;
  };
}

export interface MethodInfo {
  name: string;
  family: string;
  isServable: boolean;
  serveTierLabel: string;
  telemetryCoverage: string | null;
  isAdapted: boolean;
  blurb: string;
}

export interface MethodsResult {
  schemaVersion: number;
  defaultServeMethod: string;
  accountingOnly: true;
  accountingNote: string;
  methods: MethodInfo[];
}

/** A model's weights as cached on disk (via the Hugging Face hub cache). */
export interface LocalModel {
  id: string;
  sizeBytes: number;
  lastUsedAt: Date | null;
}

export type OptimizeProfile = 'speed' | 'balanced' | 'memory' | 'maximum-context';

export interface OptimizeInput {
  headDim?: number;
  seqLen?: number;
  nLayers?: number;
  batchSize?: number;
  profile?: OptimizeProfile;
}

export interface OptimizeResult extends AutoConfigResult {
  profile: OptimizeProfile;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the model produced it — parse with JSON.parse() and validate before use. */
  argumentsJson: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Only on assistant messages that called a tool. */
  toolCalls?: ToolCall[];
  /** Only on tool-role messages: which tool call this result answers. */
  toolCallId?: string;
}

/**
 * A tool definition in the OpenAI `tools` request-parameter shape — reused
 * deliberately rather than inventing a bespoke schema, since the underlying
 * mlx_lm server (which veloxquant serve wraps) already parses tool calls
 * against a tokenizer-native chat template keyed on this exact shape.
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatInput {
  model: string;
  messages?: ChatMessage[];
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  tools?: ToolDefinition[];
}

export interface ChatResponse {
  text: string;
  model: string;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  toolCalls: ToolCall[] | null;
}

export interface StreamChunk {
  text: string;
  done: boolean;
}

export interface ServeHandle {
  baseUrl: string;
  model: string;
  method: string;
  port: number;
  pid: number;
  stop(): Promise<void>;
}

export interface LoadOptions {
  model: string;
  method?: string;
  bits?: number;
  port?: number;
  host?: string;
  optimize?: 'auto' | false;
  seqLen?: number;
  nLayers?: number;
}
