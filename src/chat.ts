import type { ChatInput, ChatMessage, ChatResponse, ServeHandle, StreamChunk, ToolCall } from './types.js';

function toMessages(input: ChatInput): ChatMessage[] {
  if (input.messages && input.messages.length > 0) return input.messages;
  if (input.prompt) return [{ role: 'user', content: input.prompt }];
  throw new Error('chat() requires either `messages` or `prompt`.');
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.toolCalls && m.toolCalls.length > 0) {
    wire.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.argumentsJson },
    }));
  }
  if (m.toolCallId) wire.tool_call_id = m.toolCallId;
  return wire;
}

interface OpenAIToolCallPayload {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function toToolCalls(raw: OpenAIToolCallPayload[] | undefined): ToolCall[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map((tc) => ({ id: tc.id, name: tc.function.name, argumentsJson: tc.function.arguments }));
}

interface OpenAIChatCompletionResponse {
  choices: Array<{
    message?: { content: string; tool_calls?: OpenAIToolCallPayload[] };
    finish_reason: string | null;
  }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/** Sends a single (non-streaming) chat completion to a running serve() handle. */
export async function chatCompletion(handle: ServeHandle, input: ChatInput): Promise<ChatResponse> {
  const res = await fetch(`${handle.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      messages: toMessages(input).map(toWireMessage),
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      tools: input.tools,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`veloxquant serve returned HTTP ${res.status}: ${await res.text()}`);
  }

  const payload = (await res.json()) as OpenAIChatCompletionResponse;
  const choice = payload.choices[0];

  return {
    text: choice?.message?.content ?? '',
    model: payload.model,
    finishReason: choice?.finish_reason ?? null,
    usage: payload.usage
      ? {
          promptTokens: payload.usage.prompt_tokens,
          completionTokens: payload.usage.completion_tokens,
          totalTokens: payload.usage.total_tokens,
        }
      : null,
    toolCalls: toToolCalls(choice?.message?.tool_calls),
  };
}

interface OpenAIStreamChunkPayload {
  choices: Array<{ delta?: { content?: string }; finish_reason: string | null }>;
}

/** Streams a chat completion token-by-token via SSE from a running serve() handle. */
export async function* chatStream(handle: ServeHandle, input: ChatInput): AsyncGenerator<StreamChunk> {
  const res = await fetch(`${handle.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      messages: toMessages(input),
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`veloxquant serve returned HTTP ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice('data:'.length).trim();
        if (data === '[DONE]') {
          yield { text: '', done: true };
          return;
        }
        const parsed = JSON.parse(data) as OpenAIStreamChunkPayload;
        const delta = parsed.choices[0]?.delta?.content ?? '';
        const finished = parsed.choices[0]?.finish_reason !== null && parsed.choices[0]?.finish_reason !== undefined;
        if (delta) yield { text: delta, done: false };
        if (finished) {
          yield { text: '', done: true };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
