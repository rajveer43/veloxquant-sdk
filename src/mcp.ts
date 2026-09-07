import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolSpec } from './agent.js';

export interface McpStdioConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpConfig {
  transport: 'sse' | 'http';
  url: string;
}

/**
 * Either connect this module to a server (stdio/sse/http — one of the
 * transport variants) or hand it an already-connected Client. In the first
 * case this module opened the connection and owns closing it; in the
 * second, the caller retains ownership and close() is a no-op — mirroring
 * how VeloxQuantModel lifecycle is handled elsewhere in this SDK (see
 * src/langchain.ts, src/ai-sdk.ts doc comments).
 */
export type McpServerConfig = { name: string } & (McpStdioConfig | McpHttpConfig | { client: Client });

export interface McpToolSource {
  readonly name: string;
  listTools(): Promise<ToolSpec[]>;
  close(): Promise<void>;
}

interface RawMcpToolResult {
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'audio'; data: string; mimeType: string }
    | { type: 'resource'; resource: unknown }
    | { type: 'resource_link'; uri: string }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Unwraps an MCP CallToolResult into the plain JS value Agent.run() expects
 * to JSON.stringify() back to the model. Prefers structuredContent when the
 * server provides it (already a plain object, no parsing needed). Otherwise
 * handles the common case of a single text content block, parsing it as
 * JSON when it looks like JSON and falling back to the raw string. Throws a
 * clear, actionable error for unsupported content types (image/audio/
 * resource/resource_link) rather than silently dropping them — those
 * require a real design decision (e.g. how to surface an image to a
 * text-only chat model) that hasn't been made yet, so failing loudly beats
 * guessing.
 */
export function unwrapMcpToolResult(result: RawMcpToolResult): unknown {
  if (result.structuredContent) return result.structuredContent;

  const content = result.content ?? [];
  if (content.length === 0) return null;

  const unsupported = content.find((c) => c.type !== 'text');
  if (unsupported) {
    throw new Error(
      `MCP tool result contained unsupported content type "${unsupported.type}" — only "text" content ` +
        '(or structuredContent) is currently unwrapped into a tool result. Image/audio/resource content ' +
        'needs a deliberate design decision about how to surface it to a text-only chat model.',
    );
  }

  if (content.length === 1) {
    const text = (content[0] as { type: 'text'; text: string }).text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return content.map((c) => (c as { type: 'text'; text: string }).text);
}

/** Builds the transport for a config that isn't an already-connected Client. */
function buildTransport(config: McpStdioConfig | McpHttpConfig) {
  if (config.transport === 'stdio') {
    const params: StdioServerParameters = { command: config.command, args: config.args, env: config.env };
    return new StdioClientTransport(params);
  }
  if (config.transport === 'sse') {
    return new SSEClientTransport(new URL(config.url));
  }
  return new StreamableHTTPClientTransport(new URL(config.url));
}

/**
 * Connects to an MCP server and exposes its tools in this SDK's ToolSpec
 * shape (see src/agent.ts). Uses the official @modelcontextprotocol/sdk
 * package rather than hand-rolling the MCP wire protocol.
 */
export async function connectMcpServer(config: McpServerConfig): Promise<McpToolSource> {
  const ownsConnection = !('client' in config);
  const client =
    'client' in config
      ? config.client
      : new Client({ name: `veloxquant-sdk-agent-${config.name}`, version: '1' });

  if (ownsConnection) {
    const transport = buildTransport(config as McpStdioConfig | McpHttpConfig);
    await client.connect(transport);
  }

  return {
    name: config.name,
    async listTools(): Promise<ToolSpec[]> {
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
        execute: async (args: Record<string, unknown>) => {
          const result = await client.callTool({ name: t.name, arguments: args });
          return unwrapMcpToolResult(result as RawMcpToolResult);
        },
      }));
    },
    async close(): Promise<void> {
      if (ownsConnection) await client.close();
    },
  };
}
