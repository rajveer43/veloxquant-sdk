import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VeloxQuantLLM } from '../../src/llamaindex.js';
import type { ChatInput, ChatResponse, StreamChunk } from '../../src/types.js';
import type { VeloxQuantModel } from '../../src/client.js';

function fakeModel(
  responses: ChatResponse[],
  streamChunks: StreamChunk[] = [],
): VeloxQuantModel & { calls: ChatInput[]; streamCalls: ChatInput[] } {
  const calls: ChatInput[] = [];
  const streamCalls: ChatInput[] = [];
  let i = 0;
  return {
    calls,
    streamCalls,
    baseUrl: 'http://127.0.0.1:1',
    model: 'fake-model',
    method: 'turboquant_rvq',
    pid: 1,
    chat: async (input: ChatInput) => {
      calls.push(input);
      const response = responses[i];
      i += 1;
      if (!response) throw new Error('fakeModel: ran out of scripted responses');
      return response;
    },
    stream: async function* (input: ChatInput) {
      streamCalls.push(input);
      for (const chunk of streamChunks) yield chunk;
    },
    stop: async () => {},
  } as unknown as VeloxQuantModel & { calls: ChatInput[]; streamCalls: ChatInput[] };
}

function textResponse(text: string): ChatResponse {
  return { text, model: 'fake-model', finishReason: 'stop', usage: null, toolCalls: null, json: null };
}

test('VeloxQuantLLM.metadata: derives model id from the served model, defaults contextWindow', () => {
  const llm = new VeloxQuantLLM(fakeModel([]));
  assert.equal(llm.metadata.model, 'fake-model');
  assert.equal(llm.metadata.contextWindow, 3900);
});

test('VeloxQuantLLM.metadata: contextWindow can be overridden via constructor options', () => {
  const llm = new VeloxQuantLLM(fakeModel([]), { contextWindow: 32768 });
  assert.equal(llm.metadata.contextWindow, 32768);
});

test('VeloxQuantLLM.chat(): non-streaming converts messages and returns an assistant ChatResponse', async () => {
  const model = fakeModel([textResponse('Paris is the capital.')]);
  const llm = new VeloxQuantLLM(model);

  const response = await llm.chat({
    messages: [
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: "What's the capital of France?" },
    ],
  });

  assert.equal(response.message.role, 'assistant');
  assert.equal(response.message.content, 'Paris is the capital.');
  assert.deepEqual(
    model.calls[0].messages?.map((m) => m.role),
    ['system', 'user'],
  );
  assert.deepEqual(
    model.calls[0].messages?.map((m) => m.content),
    ['Be terse.', "What's the capital of France?"],
  );
});

test('VeloxQuantLLM.chat(): streaming yields real token deltas', async () => {
  const model = fakeModel(
    [],
    [
      { text: 'Par', done: false },
      { text: 'is', done: false },
      { text: '', done: true },
    ],
  );
  const llm = new VeloxQuantLLM(model);

  const stream = await llm.chat({ messages: [{ role: 'user', content: 'hi' }], stream: true });
  const deltas: string[] = [];
  for await (const chunk of stream) deltas.push(chunk.delta);

  assert.deepEqual(deltas, ['Par', 'is']);
  assert.equal(model.streamCalls.length, 1);
});

test('VeloxQuantLLM.complete(): single-prompt convenience matches an equivalent chat() call', async () => {
  const model = fakeModel([textResponse('Paris is the capital.')]);
  const llm = new VeloxQuantLLM(model);

  const response = await llm.complete({ prompt: "What's the capital of France?" });
  assert.equal(response.text, 'Paris is the capital.');
  assert.deepEqual(
    model.calls[0].messages?.map((m) => ({ role: m.role, content: m.content })),
    [{ role: 'user', content: "What's the capital of France?" }],
  );
});

test('VeloxQuantLLM: an unsupported message role throws instead of being silently coerced', async () => {
  const model = fakeModel([]);
  const llm = new VeloxQuantLLM(model);

  await assert.rejects(
    () => llm.chat({ messages: [{ role: 'memory' as never, content: 'x' }] }),
    /unsupported LlamaIndex message role "memory"/,
  );
});

test('VeloxQuantLLM: a "developer" role message maps to "system" on the wire, not dropped or thrown', async () => {
  const model = fakeModel([textResponse('ok')]);
  const llm = new VeloxQuantLLM(model);

  await llm.chat({ messages: [{ role: 'developer' as never, content: 'Follow the rules.' }] });
  assert.equal(model.calls[0].messages?.[0].role, 'system');
  assert.equal(model.calls[0].messages?.[0].content, 'Follow the rules.');
});
