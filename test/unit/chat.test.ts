import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInstructions, parseResponseFormat, chatStream } from '../../src/chat.js';
import type { ServeHandle, StreamChunk } from '../../src/types.js';

function fakeHandle(): ServeHandle {
  return {
    baseUrl: 'http://127.0.0.1:1',
    model: 'fake-model',
    method: 'turboquant_rvq',
    port: 1,
    pid: 1,
    stop: async () => {},
  };
}

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

test('formatInstructions: json_object asks for a bare JSON object with no schema', () => {
  const instructions = formatInstructions({ type: 'json_object' });
  assert.match(instructions, /valid JSON object/);
  assert.doesNotMatch(instructions, /JSON Schema/);
});

test('formatInstructions: json_schema embeds the schema', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
  const instructions = formatInstructions({ type: 'json_schema', schema });
  assert.match(instructions, /JSON Schema/);
  assert.match(instructions, /"name"/);
});

test('parseResponseFormat: parses a plain JSON object', () => {
  const result = parseResponseFormat('{"name": "John", "age": 30}');
  assert.deepEqual(result, { name: 'John', age: 30 });
});

test('parseResponseFormat: strips markdown code fences before parsing', () => {
  const result = parseResponseFormat('```json\n{"ok": true}\n```');
  assert.deepEqual(result, { ok: true });
});

test('parseResponseFormat: strips bare fences without a language tag', () => {
  const result = parseResponseFormat('```\n{"ok": true}\n```');
  assert.deepEqual(result, { ok: true });
});

test('parseResponseFormat: throws a descriptive error (not a raw SyntaxError) on invalid JSON', () => {
  assert.throws(
    () => parseResponseFormat('Sure! Here is your answer: not json'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /responseFormat was requested but the model's output could not be parsed as JSON/);
      assert.match(err.message, /Raw output: Sure! Here is your answer: not json/);
      return true;
    },
  );
});

test('chatStream: yields plain text deltas from SSE content chunks', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'Hel' }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: { content: 'lo' }, finish_reason: null }] }),
      '[DONE]',
    ]),
  );

  const chunks = await collect(chatStream(fakeHandle(), { model: 'fake-model', prompt: 'hi' }));
  assert.deepEqual(
    chunks.map((c) => c.text),
    ['Hel', 'lo', ''],
  );
  assert.deepEqual(
    chunks.map((c) => c.done),
    [false, false, true],
  );
});

test('chatStream: sends tools in the streaming request body (regression: this was previously omitted)', async (t) => {
  let sentBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sentBody = JSON.parse(init.body as string);
    return sseResponse(['[DONE]']);
  });

  const tools = [{ type: 'function' as const, function: { name: 'get_weather', parameters: { type: 'object' } } }];
  await collect(chatStream(fakeHandle(), { model: 'fake-model', prompt: 'weather?', tools }));

  assert.deepEqual(sentBody?.tools, tools);
});

test('chatStream: parses complete tool-call objects out of delta.tool_calls', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    sseResponse([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' } }],
            },
            finish_reason: null,
          },
        ],
      }),
      '[DONE]',
    ]),
  );

  const chunks = await collect(chatStream(fakeHandle(), { model: 'fake-model', prompt: 'weather in Tokyo?' }));
  const withToolCalls = chunks.find((c) => c.toolCalls);
  assert.deepEqual(withToolCalls?.toolCalls, [
    { id: 'call_1', name: 'get_weather', argumentsJson: '{"location":"Tokyo"}' },
  ]);
});
