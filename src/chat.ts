import type { ChatInput, ChatMessage, ChatResponse, ResponseFormat, ServeHandle, StreamChunk, ToolCall } from './types.js';

function toMessages(input: ChatInput): ChatMessage[] {
  if (input.messages && input.messages.length > 0) return input.messages;
  if (input.prompt) return [{ role: 'user', content: input.prompt }];
  throw new Error('chat() requires either `messages` or `prompt`.');
}

/**
 * mlx_lm's server doesn't honor `response_format` (see issue #14
 * investigation) — there's no grammar-constrained decoding underneath, so
 * this is a best-effort nudge, not a guarantee. Appended as a trailing
 * system message rather than mutating an existing one so it survives
 * regardless of whether the caller already supplied a system prompt.
 */
export function formatInstructions(format: ResponseFormat): string {
  if (format.type === 'json_object') {
    return 'Respond with a single valid JSON object and nothing else — no markdown code fences, no commentary before or after it.';
  }
  return (
    'Respond with a single valid JSON object matching this JSON Schema, and nothing else — ' +
    `no markdown code fences, no commentary before or after it.\n\nJSON Schema:\n${JSON.stringify(format.schema)}`
  );
}

function withResponseFormatInstructions(messages: ChatMessage[], format: ResponseFormat | undefined): ChatMessage[] {
  if (!format) return messages;
  return [...messages, { role: 'system', content: formatInstructions(format) }];
}

/** Strips markdown code fences a model may wrap JSON in despite instructions not to, then parses. Throws a descriptive error (not a raw JSON.parse SyntaxError) on failure — see ChatResponse.json in src/types.ts. */
export function parseResponseFormat(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `responseFormat was requested but the model's output could not be parsed as JSON: ${(err as Error).message}\nRaw output: ${text}`,
    );
  }
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
  const messages = withResponseFormatInstructions(toMessages(input), input.responseFormat);

  const res = await fetch(`${handle.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      messages: messages.map(toWireMessage),
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      tools: input.tools,
      response_format: input.responseFormat,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`veloxquant serve returned HTTP ${res.status}: ${await res.text()}`);
  }

  const payload = (await res.json()) as OpenAIChatCompletionResponse;
  const choice = payload.choices[0];
  const text = choice?.message?.content ?? '';

  return {
    text,
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
    json: input.responseFormat ? parseResponseFormat(text) : null,
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
