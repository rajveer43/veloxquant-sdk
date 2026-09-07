import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectMcpServer, unwrapMcpToolResult } from '../../src/mcp.js';

interface FakeToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * A duck-typed fake of @modelcontextprotocol/sdk's Client — connectMcpServer
 * only ever calls listTools()/callTool()/close() on it, never anything from
 * the real Client's internals, so a plain object cast through `unknown` is
 * sufficient and avoids spinning up a real MCP transport in unit tests.
 */
function fakeClient(opts: {
  tools: FakeToolDef[];
  callToolResult?: (name: string, args: unknown) => unknown;
}): Client {
  return {
    listTools: async () => ({ tools: opts.tools }),
    callTool: async ({ name, arguments: args }: { name: string; arguments: unknown }) =>
      opts.callToolResult?.(name, args) ?? { ok: true },
    close: async () => {},
  } as unknown as Client;
}

test('connectMcpServer: with a caller-supplied client, listTools() maps MCP tools to ToolSpec', async () => {
  const client = fakeClient({
    tools: [
      { name: 'get_weather', description: 'Get weather', inputSchema: { type: 'object', properties: {} } },
    ],
  });

  const source = await connectMcpServer({ name: 'test-server', client });
  const tools = await source.listTools();

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'get_weather');
  assert.equal(tools[0].description, 'Get weather');
  assert.deepEqual(tools[0].parameters, { type: 'object', properties: {} });
});

test('connectMcpServer: a tool.execute() calls client.callTool() and unwraps the result', async () => {
  let calledWith: { name: string; args: unknown } | null = null;
  const client = fakeClient({
    tools: [{ name: 'get_weather', inputSchema: { type: 'object' } }],
    callToolResult: (name, args) => {
      calledWith = { name, args };
      return { content: [{ type: 'text', text: JSON.stringify({ tempC: 22 }) }] };
    },
  });

  const source = await connectMcpServer({ name: 'test-server', client });
  const [tool] = await source.listTools();
  const result = await tool.execute({ location: 'Tokyo' });

  assert.deepEqual(calledWith, { name: 'get_weather', args: { location: 'Tokyo' } });
  assert.deepEqual(result, { tempC: 22 });
});

test('connectMcpServer: with a caller-supplied client, close() does not call client.close() (caller owns the connection)', async () => {
  const client = fakeClient({ tools: [] });
  let closeCalls = 0;
  client.close = async () => {
    closeCalls += 1;
  };

  const source = await connectMcpServer({ name: 'test-server', client });
  await source.close();

  assert.equal(closeCalls, 0);
});

test('unwrapMcpToolResult: prefers structuredContent when present', () => {
  const result = unwrapMcpToolResult({
    structuredContent: { tempC: 22 },
    content: [{ type: 'text', text: 'ignored' }],
  });
  assert.deepEqual(result, { tempC: 22 });
});

test('unwrapMcpToolResult: a single text block that looks like JSON is parsed', () => {
  const result = unwrapMcpToolResult({ content: [{ type: 'text', text: '{"tempC":22}' }] });
  assert.deepEqual(result, { tempC: 22 });
});

test('unwrapMcpToolResult: a single text block that is not JSON is returned as a plain string', () => {
  const result = unwrapMcpToolResult({ content: [{ type: 'text', text: 'It is sunny.' }] });
  assert.equal(result, 'It is sunny.');
});

test('unwrapMcpToolResult: multiple text blocks are returned as a string array', () => {
  const result = unwrapMcpToolResult({
    content: [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ],
  });
  assert.deepEqual(result, ['first', 'second']);
});

test('unwrapMcpToolResult: an empty content array returns null', () => {
  const result = unwrapMcpToolResult({ content: [] });
  assert.equal(result, null);
});

test('unwrapMcpToolResult: an unsupported content type (image) throws a clear, actionable error', () => {
  assert.throws(
    () => unwrapMcpToolResult({ content: [{ type: 'image', data: 'base64...', mimeType: 'image/png' }] }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /unsupported content type "image"/);
      return true;
    },
  );
});
