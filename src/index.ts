export { VeloxQuant, VeloxQuantModel } from './client.js';
export { autopilot, AutopilotFitError, AutopilotSession } from './autopilot.js';
export { getSystemInfo } from './system.js';
export { VeloxQuantWorker, startWorker, decodeWorkerResponse } from './python/worker.js';
export type { WorkerOptions, WorkerResponse, MetalProbeResult, WorkerCapabilities, BitPackResult, BitPackFileResult, RopeRecodeFileResult } from './python/worker.js';
export { VeloxQuantWorker, startWorker, decodeWorkerResponse } from './python/worker.js';
export type { WorkerOptions, WorkerResponse } from './python/worker.js';
export type { MetalProbeResult } from './python/worker.js';
export type { WorkerCapabilities, BitPackResult } from './python/worker.js';
export type { BitPackFileResult } from './python/worker.js';
export type { RopeRecodeFileResult } from './python/worker.js';
export { autoConfig, estimateMemory } from './memory.js';
export { recommend, normalizeChip, normalizeRamGb, SUPPORTED_CHIPS, SUPPORTED_RAM_GB } from './recommend.js';
export { listMethods } from './methods.js';
export { listLocalModels, pullLocalModel, deleteLocalModel } from './localModels.js';
export { optimize } from './optimize.js';
export { benchmark } from './benchmark.js';
export { Agent, createAgent } from './agent.js';
export { Conversation } from './conversation.js';
export { startServer } from './serve.js';
export { chatCompletion, chatStream } from './chat.js';
export { formatBytes } from './cli/format.js';
export {
  InterpreterInvalidError,
  ModuleNotFoundInInterpreterError,
  resolveInterpreter,
  getInstalledVersion,
} from './python/interpreter.js';

export type { AutopilotInput } from './autopilot.js';
export type { BenchmarkInput, BenchmarkResult } from './benchmark.js';
export type { ToolSpec, AgentRunOptions, AgentStep, AgentRunResult } from './agent.js';
/**
 * McpServerConfig/McpStdioConfig/McpHttpConfig/McpToolSource and the
 * connectMcpServer/unwrapMcpToolResult functions are intentionally NOT
 * re-exported from this entrypoint: mcp.ts imports the optional peer
 * dependency @modelcontextprotocol/sdk, and a static re-export here would
 * force that import to be bundled/evaluated eagerly whenever anyone
 * imports @veloxquant/sdk at all — breaking the base package for callers
 * who never touch MCP and don't have the MCP SDK installed (verified: a
 * static `export ... from './mcp.js'` here pulled @modelcontextprotocol/sdk
 * into dist/index.js's own eager import graph, even though agent.ts's own
 * usage is a dynamic `await import('./mcp.js')` and builds into its own
 * lazy chunk on its own). `Agent.useMcpServer(config)` is the intended
 * public surface for MCP support and lazy-loads mcp.ts itself — for the
 * lower-level types/helpers, import from '@veloxquant/sdk/mcp' instead.
 */
export type { ConversationOptions, ConversationSendOptions } from './conversation.js';

export type {
  VeloxQuantOptions,
  SystemInfo,
  HardwareInfo,
  WorkloadSpecInput,
  AutoConfigConfig,
  AutoConfigResult,
  MemoryEstimateInput,
  MemoryEstimate,
  Chip,
  RamGb,
  ModelClass,
  Goal,
  RecommendInput,
  RecommendResult,
  MethodInfo,
  MethodsResult,
  LocalModel,
  PullModelResult,
  DeleteModelResult,
  OptimizeProfile,
  OptimizeInput,
  OptimizeResult,
  ChatMessage,
  ChatInput,
  ChatResponse,
  ResponseFormat,
  ToolCall,
  ToolDefinition,
  StreamChunk,
  ServeHandle,
  LoadOptions,
} from './types.js';
