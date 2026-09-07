import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { VeloxQuantChatModel } from '../../src/langchain.js';
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

test('VeloxQuantChatModel.invoke(): converts a plain string prompt and returns an AIMessage', async () => {
  const model = fakeModel([textResponse('Hello there.')]);
  const chatModel = new VeloxQuantChatModel(model);

  const result = await chatModel.invoke('Hi');
  assert.equal(result.content, 'Hello there.');
  assert.equal(model.calls[0].messages?.[0].role, 'user');
  assert.equal(model.calls[0].messages?.[0].content, 'Hi');
});

test('VeloxQuantChatModel.invoke(): maps LangChain message roles to VeloxQuant wire roles', async () => {
  const model = fakeModel([textResponse('ok')]);
  const chatModel = new VeloxQuantChatModel(model);

  await chatModel.invoke([
    new SystemMessage('Be terse.'),
    new HumanMessage('Hi'),
    new AIMessage('Hello!'),
    new HumanMessage('And?'),
  ]);

  const sent = model.calls[0].messages;
  assert.deepEqual(
    sent?.map((m) => m.role),
    ['system', 'user', 'assistant', 'user'],
  );
  assert.deepEqual(
    sent?.map((m) => m.content),
    ['Be terse.', 'Hi', 'Hello!', 'And?'],
  );
});

test('VeloxQuantChatModel._generate(): surfaces tool calls on the returned AIMessage', async () => {
  const toolCallResp: ChatResponse = {
    text: '',
    model: 'fake-model',
    finishReason: 'tool_calls',
    usage: null,
    toolCalls: [{ id: 'call_1', name: 'get_weather', argumentsJson: '{"location":"Tokyo"}' }],
    json: null,
  };
  const model = fakeModel([toolCallResp]);
  const chatModel = new VeloxQuantChatModel(model);

  const result = await chatModel.invoke('weather in Tokyo?');
  assert.deepEqual(result.tool_calls, [{ id: 'call_1', name: 'get_weather', args: { location: 'Tokyo' } }]);
});

test('VeloxQuantChatModel._llmType(): identifies the provider', () => {
  const model = fakeModel([]);
  const chatModel = new VeloxQuantChatModel(model);
  assert.equal(chatModel._llmType(), 'veloxquant');
});

test('VeloxQuantChatModel.stream(): yields real token deltas instead of buffering', async () => {
  const model = fakeModel(
    [],
    [
      { text: 'Hel', done: false },
      { text: 'lo ', done: false },
      { text: 'there.', done: false },
      { text: '', done: true },
    ],
  );
  const chatModel = new VeloxQuantChatModel(model);

  const parts: string[] = [];
  const stream = await chatModel.stream('Hi');
  for await (const chunk of stream) {
    if (typeof chunk.content === 'string' && chunk.content) parts.push(chunk.content);
  }

  assert.deepEqual(parts, ['Hel', 'lo ', 'there.']);
  assert.equal(parts.join(''), 'Hello there.');
  assert.equal(model.streamCalls.length, 1);
});

test('VeloxQuantChatModel.stream(): surfaces tool-call chunks without dropping them', async () => {
  const model = fakeModel(
    [],
    [
      {
        text: '',
        done: false,
        toolCalls: [{ id: 'call_1', name: 'get_weather', argumentsJson: '{"location":"Tokyo"}' }],
      },
      { text: '', done: true },
    ],
  );
  const chatModel = new VeloxQuantChatModel(model);

  const toolCallChunks: unknown[] = [];
  const stream = await chatModel.stream('weather in Tokyo?');
  for await (const chunk of stream) {
    if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
      toolCallChunks.push(...chunk.tool_call_chunks);
    }
  }

  assert.deepEqual(toolCallChunks, [
    { type: 'tool_call_chunk', id: 'call_1', name: 'get_weather', args: '{"location":"Tokyo"}', index: 0 },
  ]);
});

test('VeloxQuantChatModel: an LCEL chain streamed end-to-end matches the invoke() result', async () => {
  const chunks = [
    { text: 'Paris', done: false },
    { text: ' is', done: false },
    { text: ' the capital.', done: false },
    { text: '', done: true },
  ];

  const invokeModel = fakeModel([
    { text: 'Paris is the capital.', model: 'fake-model', finishReason: 'stop', usage: null, toolCalls: null, json: null },
  ]);
  const streamModel = fakeModel([], chunks);

  const prompt = ChatPromptTemplate.fromMessages([['human', '{question}']]);
  const parser = new StringOutputParser();

  const invokeChain = prompt.pipe(new VeloxQuantChatModel(invokeModel)).pipe(parser);
  const streamChain = prompt.pipe(new VeloxQuantChatModel(streamModel)).pipe(parser);

  const invokeResult = await invokeChain.invoke({ question: "What's the capital of France?" });

  let streamedResult = '';
  for await (const part of await streamChain.stream({ question: "What's the capital of France?" })) {
    streamedResult += part;
  }

  assert.equal(streamedResult, invokeResult);
  assert.equal(streamedResult, 'Paris is the capital.');
});
