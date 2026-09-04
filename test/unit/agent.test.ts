import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../../src/agent.js';
import type { ChatInput, ChatResponse } from '../../src/types.js';
import type { VeloxQuantModel } from '../../src/client.js';

function fakeModel(responses: ChatResponse[]): VeloxQuantModel & { calls: ChatInput[] } {
  const calls: ChatInput[] = [];
  let i = 0;
  const stopped = { value: false };
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
    stop: async () => {
      stopped.value = true;
    },
  } as unknown as VeloxQuantModel & { calls: ChatInput[] };
}

function textResponse(text: string): ChatResponse {
  return { text, model: 'fake-model', finishReason: 'stop', usage: null, toolCalls: null, json: null };
}

function toolCallResponse(name: string, argumentsJson: string, id = 'call_1'): ChatResponse {
  return {
    text: '',
    model: 'fake-model',
    finishReason: 'tool_calls',
    usage: null,
    toolCalls: [{ id, name, argumentsJson }],
    json: null,
  };
}

test('Agent.run(): no tools called returns the text directly with no steps', async () => {
  const model = fakeModel([textResponse('Hello!')]);
  const agent = new Agent(model);
  const result = await agent.run('hi');
  assert.equal(result.text, 'Hello!');
  assert.deepEqual(result.steps, []);
});

test('Agent.run(): executes a tool call and feeds the result back for a final answer', async () => {
  const model = fakeModel([
    toolCallResponse('get_weather', '{"location":"Tokyo"}'),
    textResponse('It is sunny in Tokyo.'),
  ]);
  const agent = new Agent(model);
  let executedWith: unknown = null;
  agent.tool({
    name: 'get_weather',
    parameters: { type: 'object', properties: { location: { type: 'string' } } },
    execute: async (args) => {
      executedWith = args;
      return { condition: 'sunny' };
    },
  });

  const result = await agent.run('weather in Tokyo?');
  assert.equal(result.text, 'It is sunny in Tokyo.');
  assert.deepEqual(executedWith, { location: 'Tokyo' });
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].toolName, 'get_weather');
  assert.deepEqual(result.steps[0].result, { condition: 'sunny' });

  // Second call should include the tool result fed back as a "tool" message.
  const secondCall = model.calls[1];
  const toolMessage = secondCall.messages?.find((m) => m.role === 'tool');
  assert.ok(toolMessage, 'expected a tool-role message in the follow-up request');
  assert.equal(toolMessage?.toolCallId, 'call_1');
});

test('Agent.run(): calling an unregistered tool feeds back an error instead of throwing', async () => {
  const model = fakeModel([toolCallResponse('unknown_tool', '{}'), textResponse('done')]);
  const agent = new Agent(model);

  const result = await agent.run('do something');
  assert.equal(result.text, 'done');
  const secondCall = model.calls[1];
  const toolMessage = secondCall.messages?.find((m) => m.role === 'tool');
  assert.ok((toolMessage?.content ?? '').includes('No tool named'));
  assert.ok((toolMessage?.content ?? '').includes('unknown_tool'));
});

test('Agent.run(): malformed tool-call arguments feed back a parse error instead of throwing', async () => {
  const model = fakeModel([toolCallResponse('get_weather', '{not valid json'), textResponse('done')]);
  const agent = new Agent(model);
  agent.tool({
    name: 'get_weather',
    parameters: {},
    execute: async () => ({ ok: true }),
  });

  const result = await agent.run('weather?');
  assert.equal(result.text, 'done');
  const secondCall = model.calls[1];
  const toolMessage = secondCall.messages?.find((m) => m.role === 'tool');
  assert.match(toolMessage?.content ?? '', /Could not parse arguments as JSON/);
});

test('Agent.run(): a tool that throws feeds back the error rather than crashing the run', async () => {
  const model = fakeModel([toolCallResponse('get_weather', '{}'), textResponse('done')]);
  const agent = new Agent(model);
  agent.tool({
    name: 'get_weather',
    parameters: {},
    execute: async () => {
      throw new Error('network down');
    },
  });

  const result = await agent.run('weather?');
  assert.equal(result.text, 'done');
  assert.deepEqual(result.steps[0].result, { error: 'network down' });
});

test('Agent.run(): exceeds maxSteps throws a clear error rather than looping forever', async () => {
  const responses = Array.from({ length: 5 }, () => toolCallResponse('get_weather', '{}'));
  const model = fakeModel(responses);
  const agent = new Agent(model);
  agent.tool({ name: 'get_weather', parameters: {}, execute: async () => ({}) });

  await assert.rejects(() => agent.run('loop forever', { maxSteps: 3 }), /exceeded maxSteps \(3\)/);
});

test('Agent.tool(): registering a duplicate tool name throws', () => {
  const model = fakeModel([]);
  const agent = new Agent(model);
  agent.tool({ name: 'dup', parameters: {}, execute: async () => null });
  assert.throws(() => agent.tool({ name: 'dup', parameters: {}, execute: async () => null }), /already registered/);
});

test('Agent.stop(): delegates to the underlying model.stop()', async () => {
  let stopped = false;
  const model = fakeModel([]);
  model.stop = async () => {
    stopped = true;
  };
  const agent = new Agent(model);
  await agent.stop();
  assert.equal(stopped, true);
});
