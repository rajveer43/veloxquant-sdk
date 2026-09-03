import type { VeloxQuantModel } from './client.js';
import type { ChatMessage, ToolDefinition } from './types.js';

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
 * No MCP support and no multi-step planning beyond a tool-call round-trip
 * loop (call tools -> feed results back -> repeat until the model stops
 * calling tools or maxSteps is hit) — deliberately out of scope, see the
 * design-discussion issue this implements.
 */
export class Agent {
  private readonly tools = new Map<string, ToolSpec>();

  constructor(private readonly model: VeloxQuantModel) {}

  /** Stops the underlying server. Only meaningful when this agent owns its model's lifecycle (see VeloxQuant.agent()). */
  async stop(): Promise<void> {
    await this.model.stop();
  }

  tool<Args = Record<string, unknown>>(spec: ToolSpec<Args>): void {
    if (this.tools.has(spec.name)) {
      throw new Error(`A tool named "${spec.name}" is already registered on this agent.`);
    }
    this.tools.set(spec.name, spec as ToolSpec);
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
