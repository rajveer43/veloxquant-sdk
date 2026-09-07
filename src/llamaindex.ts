import {
  BaseLLM,
  DEFAULT_CONTEXT_WINDOW,
  type ChatMessage as LlamaIndexChatMessage,
  type ChatResponse as LlamaIndexChatResponse,
  type ChatResponseChunk,
  type LLMChatParamsNonStreaming,
  type LLMChatParamsStreaming,
  type LLMMetadata,
  type MessageType,
} from 'llamaindex';
import type { VeloxQuantModel } from './client.js';
import type { ChatMessage } from './types.js';

function toWireRole(type: MessageType): ChatMessage['role'] {
  switch (type) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'developer':
      // No wire equivalent for LlamaIndex's "developer" role — mapping it to
      // "system" is the closest fit (same role OpenAI's own SDKs use as a
      // developer-message fallback for non-o1 models), not a silent guess.
      return 'system';
    default:
      throw new Error(
        `VeloxQuantLLM: unsupported LlamaIndex message role "${type}" — this SDK's wire format only ` +
          'supports system/user/assistant/tool.',
      );
  }
}

function messageText(content: LlamaIndexChatMessage['content']): string {
  if (typeof content === 'string') return content;
  // MessageContent can be a MessageContentDetail[] (text/image/audio/etc.)
  // for multimodal messages. This adapter is text-only for now — concatenate
  // text parts and drop the rest rather than silently losing the request
  // shape or throwing on every multimodal message.
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function toVeloxQuantMessages(messages: LlamaIndexChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({ role: toWireRole(m.role), content: messageText(m.content) }));
}

/**
 * Wraps an already-loaded VeloxQuantModel as a LlamaIndex.TS LLM, usable
 * anywhere LlamaIndex expects one (query engines, agents, Settings.llm).
 * Same lifecycle rule as @veloxquant/sdk/ai-sdk and @veloxquant/sdk/langchain:
 * takes a running VeloxQuantModel, not a bare model name — loading is async
 * and this SDK has no disposal hook to call model.stop() on the caller's
 * behalf, so lifecycle stays explicit and in the caller's hands.
 *
 * `contextWindow` in `metadata` cannot be verified against the served
 * model — veloxquant-mlx has no LLM catalog (see the Overview section of
 * this SDK's README), so there's no source of truth for a model's actual
 * context length here. Defaults to LlamaIndex's own DEFAULT_CONTEXT_WINDOW
 * (3900) unless overridden via the `contextWindow` constructor option;
 * override it if the served model's real window matters to your use case
 * (e.g. LlamaIndex's chunking/retrieval logic sizing itself off this value).
 *
 * Text-only: tool-calling and multimodal (image/audio) messages are out of
 * scope for this version — LlamaIndex's tool metadata schema doesn't line
 * up with the OpenAI `tools` shape this SDK's Agent/wire format use
 * elsewhere, and reconciling the two needs a deliberate design pass, not a
 * guess. Non-text message content parts are dropped with a code comment
 * rather than thrown on, since a mixed text+image message shouldn't crash
 * a text-only request outright.
 *
 * @example
 * const model = await vq.load({ model: "mlx-community/Qwen3-4B-4bit", optimize: "auto" });
 * const llm = new VeloxQuantLLM(model);
 * const response = await llm.chat({ messages: [{ role: "user", content: "Hello!" }] });
 */
export class VeloxQuantLLM extends BaseLLM {
  readonly metadata: LLMMetadata;

  constructor(private readonly model: VeloxQuantModel, options: { contextWindow?: number } = {}) {
    super();
    this.metadata = {
      model: model.model,
      temperature: 0.1,
      topP: 1,
      contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      tokenizer: undefined,
      structuredOutput: false,
    };
  }

  chat(params: LLMChatParamsStreaming): Promise<AsyncIterable<ChatResponseChunk>>;
  chat(params: LLMChatParamsNonStreaming): Promise<LlamaIndexChatResponse>;
  async chat(
    params: LLMChatParamsStreaming | LLMChatParamsNonStreaming,
  ): Promise<AsyncIterable<ChatResponseChunk> | LlamaIndexChatResponse> {
    const messages = toVeloxQuantMessages(params.messages);

    if (params.stream) {
      return (async function* (model: VeloxQuantModel) {
        for await (const chunk of model.stream({ messages })) {
          if (chunk.done) return;
          if (!chunk.text) continue;
          yield { raw: null, delta: chunk.text };
        }
      })(this.model);
    }

    const response = await this.model.chat({ messages });
    return { message: { role: 'assistant', content: response.text }, raw: null };
  }
}
