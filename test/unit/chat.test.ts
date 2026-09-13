import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInstructions, parseResponseFormat, chatCompletion, chatStream } from '../../src/chat.js';
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

test('chatStream: forwards a pre-aborted signal to fetch', async (t) => {
  const controller = new AbortController();
  controller.abort();
  let receivedSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    receivedSignal = init.signal;
    throw new DOMException('aborted', 'AbortError');
  });

  await assert.rejects(
    collect(chatStream(fakeHandle(), { model: 'fake-model', prompt: 'hi', signal: controller.signal })),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(receivedSignal, controller.signal);
});

test('chatCompletion: forwards its AbortSignal to fetch', async (t) => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    receivedSignal = init.signal;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], model: 'fake-model' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  await chatCompletion(fakeHandle(), { model: 'fake-model', prompt: 'hi', signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
});

test('chatStream: aborts a pending read without stopping the model', async (t) => {
  const controller = new AbortController();
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      bodyController = streamController;
    },
  });
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    init.signal?.addEventListener('abort', () => {
      bodyController?.error(new DOMException('aborted', 'AbortError'));
    });
    return new Response(body, { status: 200 });
  });

  const iterator = chatStream(fakeHandle(), { model: 'fake-model', prompt: 'hi', signal: controller.signal });
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});

test('chatStream: returning early cancels the response reader', async (t) => {
  let cancelled = false;
  const encoder = new TextEncoder();
  let emitted = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!emitted) {
        emitted = true;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' }, finish_reason: null }] })}\n\n`),
        );
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));

  const iterator = chatStream(fakeHandle(), { model: 'fake-model', prompt: 'hi' });
  assert.equal((await iterator.next()).value?.text, 'hello');
  await iterator.return(undefined);
  assert.equal(cancelled, true);
});
