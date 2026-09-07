import type { VeloxQuantModel } from './client.js';
import type { ChatMessage, ToolDefinition } from './types.js';
import type { McpServerConfig, McpToolSource } from './mcp.js';

export interface ToolSpec<Args = Record<string, unknown>> {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments object (the "parameters" field of an OpenAI tool definition). */
  parameters: Record<string, unknown>;
  execute(args: Args): Promise<unknown> | unknown;
}

export interface AgentRunOptions {
  /** Maximum tool-call round trips before giving up. Default 8 — a runaway tool loop stops instead of looping forever. */
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentStep {
  toolName: string;
  args: unknown;
  result: unknown;
}

export interface AgentRunResult {
  text: string;
  steps: AgentStep[];
}

/**
 * Single-turn tool-calling agent over a loaded model. Reuses the OpenAI
 * `tools`/`tool_calls` wire shape end to end (see ToolDefinition/ToolCall in
 * types.ts) rather than inventing a bespoke schema, since the underlying
 * mlx_lm server (wrapped by veloxquant serve) parses tool calls natively
 * against the model's own tokenizer/chat template using exactly this shape
 * — confirmed against a real running server with mlx-community/Qwen3-4B-4bit,
 * which correctly returned a `tool_calls` response with `finish_reason:
 * "tool_calls"` for a declared function.
 *
 * Tool sources: manually registered via `tool()`, or pulled from one or
 * more MCP servers via `useMcpServer()` — both share one name/dispatch
 * namespace inside `run()`. Still no multi-step planning beyond the
 * tool-call round-trip loop (call tools -> feed results back -> repeat
 * until the model stops calling tools or maxSteps is hit), and only MCP
 * *tools* are supported — no MCP resources or prompts primitives.
 */
export class Agent {
  private readonly tools = new Map<string, ToolSpec>();
  private readonly mcpSources: McpToolSource[] = [];

  constructor(private readonly model: VeloxQuantModel) {}

  /**
   * Stops the underlying server and closes every MCP server connection this
   * agent opened itself via `useMcpServer()` — an MCP source built from a
   * caller-supplied, already-connected `Client` is left open, since that
   * connection's lifecycle belongs to whoever created it (same ownership
   * rule as passing an already-loaded VeloxQuantModel into the LangChain/AI
   * SDK adapters elsewhere in this SDK).
   */
  async stop(): Promise<void> {
    await Promise.all(this.mcpSources.map((s) => s.close()));
    await this.model.stop();
  }

  tool<Args = Record<string, unknown>>(spec: ToolSpec<Args>): void {
    if (this.tools.has(spec.name)) {
      throw new Error(`A tool named "${spec.name}" is already registered on this agent.`);
    }
    this.tools.set(spec.name, spec as ToolSpec);
  }

  /**
   * Connects to an MCP server and registers its tools alongside any
   * manually-registered ones. Can be called multiple times, including
   * after the agent has already started running, so a long-lived agent can
   * pick up more tools mid-session. Throws on a tool-name collision with an
   * already-registered tool (manual or from another MCP server) — same
   * behavior as calling `tool()` twice with the same name, since MCP tools
   * aren't treated as second-class here.
   */
  async useMcpServer(config: McpServerConfig): Promise<void> {
    /**
     * Dynamically imported rather than imported at module top level: mcp.ts
     * imports @modelcontextprotocol/sdk, an optional peer dependency (same
     * status as @langchain/core / ai). agent.ts is reachable from this
     * package's main entrypoint (src/index.ts), unlike the langchain.ts/
     * ai-sdk.ts adapter subpaths, so a top-level import here would make
     * the MCP SDK a hard dependency of the whole package instead of an
     * opt-in one only paid for by callers who actually use useMcpServer().
     */
    const { connectMcpServer } = await import('./mcp.js');
    const source = await connectMcpServer(config);
    const newTools = await source.listTools();

    const collision = newTools.find((spec) => this.tools.has(spec.name));
    if (collision) {
      await source.close().catch(() => {});
      throw new Error(
        `A tool named "${collision.name}" is already registered on this agent ` +
          `(MCP server "${config.name}" also declares a tool with this name).`,
      );
    }

    for (const spec of newTools) this.tools.set(spec.name, spec);
    this.mcpSources.push(source);
  }

  private toolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  /**
   * Sends `prompt`, executing any tools the model calls and feeding their
   * results back, until the model responds without calling a tool or
   * `maxSteps` round trips are used up (whichever comes first).
   */
  async run(prompt: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const maxSteps = options.maxSteps ?? 8;
    const tools = this.toolDefinitions();
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    const steps: AgentStep[] = [];

    for (let step = 0; step < maxSteps; step++) {
      const response = await this.model.chat({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return { text: response.text, steps };
      }

      messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });

      for (const call of response.toolCalls) {
        const spec = this.tools.get(call.name);
        if (!spec) {
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify({ error: `No tool named "${call.name}" is registered.` }),
          });
          continue;
        }

        let args: unknown;
        try {
          args = JSON.parse(call.argumentsJson);
        } catch {
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify({ error: `Could not parse arguments as JSON: ${call.argumentsJson}` }),
          });
          continue;
        }

        let result: unknown;
        try {
          result = await spec.execute(args as never);
        } catch (err) {
          result = { error: (err as Error).message };
        }

        steps.push({ toolName: call.name, args, result });
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
      }
    }

    throw new Error(
      `Agent.run() exceeded maxSteps (${maxSteps}) without a final response — ` +
        'the model kept calling tools. Pass a higher maxSteps if this is expected.',
    );
  }
}

/** Creates an Agent over an already-loaded model. Register tools with agent.tool(), then call agent.run(). */
export function createAgent(model: VeloxQuantModel): Agent {
  return new Agent(model);
}
