import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { VeloxQuantChatModel } from '../../src/langchain.js';
import type { ChatInput, ChatResponse } from '../../src/types.js';
import type { VeloxQuantModel } from '../../src/client.js';

function fakeModel(responses: ChatResponse[]): VeloxQuantModel & { calls: ChatInput[] } {
  const calls: ChatInput[] = [];
  let i = 0;
  return {
    calls,
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
    stream: async function* () {},
    stop: async () => {},
  } as unknown as VeloxQuantModel & { calls: ChatInput[] };
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
