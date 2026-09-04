import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../../src/conversation.js';
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

test('Conversation.send(): appends user + assistant turns and returns the response', async () => {
  const model = fakeModel([textResponse('Paris.'), textResponse('About 2.1 million.')]);
  const convo = new Conversation(model);

  const r1 = await convo.send("What's the capital of France?");
  assert.equal(r1.text, 'Paris.');
  assert.deepEqual(convo.messages, [
    { role: 'user', content: "What's the capital of France?" },
    { role: 'assistant', content: 'Paris.', toolCalls: undefined },
  ]);

  const r2 = await convo.send('And its population?');
  assert.equal(r2.text, 'About 2.1 million.');

  // Second call must include full accumulated history: system-less [user1, assistant1, user2].
  const secondCall = model.calls[1];
  assert.equal(secondCall.messages?.length, 3);
  assert.equal(secondCall.messages?.[2].content, 'And its population?');
});

test('Conversation constructor with system prompt: seeds history and reset() keeps it', async () => {
  const model = fakeModel([textResponse('Hi.')]);
  const convo = new Conversation(model, { system: 'You are terse.' });

  assert.deepEqual(convo.messages, [{ role: 'system', content: 'You are terse.' }]);

  await convo.send('hello');
  assert.equal(convo.messages.length, 3);

  convo.reset();
  assert.deepEqual(convo.messages, [{ role: 'system', content: 'You are terse.' }]);
});

test('Conversation.reset(): without a system prompt clears to empty', async () => {
  const model = fakeModel([textResponse('hi')]);
  const convo = new Conversation(model);
  await convo.send('hello');
  assert.equal(convo.messages.length, 2);
  convo.reset();
  assert.deepEqual(convo.messages, []);
});

test('Conversation.send(): passes through tool-call responses into history', async () => {
  const toolCallResp: ChatResponse = {
    text: '',
    model: 'fake-model',
    finishReason: 'tool_calls',
    usage: null,
    toolCalls: [{ id: 'call_1', name: 'get_weather', argumentsJson: '{"location":"Tokyo"}' }],
    json: null,
  };
  const model = fakeModel([toolCallResp]);
  const convo = new Conversation(model);

  const r = await convo.send('weather in Tokyo?', {
    tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }],
  });

  assert.deepEqual(r.toolCalls, [{ id: 'call_1', name: 'get_weather', argumentsJson: '{"location":"Tokyo"}' }]);
  const assistantMsg = convo.messages[1];
  assert.equal(assistantMsg.role, 'assistant');
  assert.deepEqual(assistantMsg.toolCalls, [{ id: 'call_1', name: 'get_weather', argumentsJson: '{"location":"Tokyo"}' }]);
});
