import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import type { ToolCallChunk } from '@langchain/core/messages/tool';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { VeloxQuantModel } from './client.js';
import type { ChatMessage, ToolCall } from './types.js';

function toWireRole(type: BaseMessage['_getType'] extends () => infer R ? R : never): ChatMessage['role'] {
  switch (type) {
    case 'human':
      return 'user';
    case 'ai':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      throw new Error(`VeloxQuantChatModel: unsupported LangChain message type "${type}".`);
  }
}

function toVeloxQuantMessages(messages: BaseMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const role = toWireRole(m._getType());
    const wire: ChatMessage = { role, content: m.text };
    if (role === 'tool') {
      const toolCallId = (m as unknown as { tool_call_id?: string }).tool_call_id;
      if (toolCallId) wire.toolCallId = toolCallId;
    }
    return wire;
  });
}

function toolCallsToLangChain(
  toolCalls: ToolCall[] | null,
): Array<{ id: string; name: string; args: Record<string, unknown> }> | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(tc.argumentsJson) as Record<string, unknown>;
    } catch {
      args = { _raw: tc.argumentsJson };
    }
    return { id: tc.id, name: tc.name, args };
  });
}

/**
 * Each streamed tool call from mlx_lm's server arrives as one complete
 * { id, name, argumentsJson } object per SSE event (verified against
 * mlx_lm/server.py's ToolCallFormatter: it serializes `arguments` to a JSON
 * string server-side and emits the whole call in one `delta.tool_calls`
 * entry, not incremental argument fragments the way OpenAI's own streaming
 * tool-call deltas work). So `args` here is always the full JSON string,
 * not a partial fragment meant to be concatenated char-by-char — LangChain's
 * own AIMessageChunk.concat() still merges these safely across chunks since
 * each chunk's chunk carries a distinct `index`.
 */
function toolCallsToLangChainChunks(toolCalls: ToolCall[] | undefined): ToolCallChunk[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc, index) => ({
    type: 'tool_call_chunk',
    id: tc.id,
    name: tc.name,
    args: tc.argumentsJson,
    index,
  }));
}

/**
 * Wraps an already-loaded VeloxQuantModel as a LangChain.js BaseChatModel,
 * usable with LCEL chains, agents, etc. Takes a running VeloxQuantModel
 * (not a bare model-name string) for the same reason as veloxquant() in
 * src/ai-sdk.ts: model loading is async (vq.load()) and this SDK doesn't
 * own a disposal hook to call model.stop() on its own, so lifecycle stays
 * in the caller's hands.
 *
 * `.stream()`/LCEL streaming is backed by `_streamResponseChunks()`, which
 * forwards `VeloxQuantModel.stream()`'s real SSE token deltas — including
 * tool-call deltas (see toolCallsToLangChainChunks() above for the wire
 * shape mlx_lm's server actually emits). One asymmetry vs. `_generate()`:
 * mlx_lm's server does not include a `usage` object on any streamed SSE
 * event (only on the non-streaming response), so token-usage metadata is
 * unavailable on the streaming path — `generationInfo`/`llmOutput` carry no
 * usage fields here, unlike `_generate()`'s `tokenUsage`.
 *
 * @example
 * const model = await vq.load({ model: "mlx-community/Qwen3-4B-4bit", optimize: "auto" });
 * const chatModel = new VeloxQuantChatModel(model);
 * const result = await chatModel.invoke("Explain quantum computing simply.");
 */
export class VeloxQuantChatModel extends BaseChatModel {
  constructor(
    private readonly model: VeloxQuantModel,
    fields: BaseChatModelParams = {},
  ) {
    super(fields);
  }

  _llmType(): string {
    return 'veloxquant';
  }

  async _generate(messages: BaseMessage[], _options: this['ParsedCallOptions'], _runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
    const response = await this.model.chat({ messages: toVeloxQuantMessages(messages) });

    const aiMessage = new AIMessage({
      content: response.text,
      tool_calls: toolCallsToLangChain(response.toolCalls),
    });

    return {
      generations: [{ text: response.text, message: aiMessage }],
      llmOutput: {
        model: response.model,
        finishReason: response.finishReason,
        tokenUsage: response.usage
          ? {
              promptTokens: response.usage.promptTokens,
              completionTokens: response.usage.completionTokens,
              totalTokens: response.usage.totalTokens,
            }
          : undefined,
      },
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const wireMessages = toVeloxQuantMessages(messages);

    for await (const chunk of this.model.stream({ messages: wireMessages })) {
      if (chunk.done) return;
      if (!chunk.text && !chunk.toolCalls) continue;

      const generationChunk = new ChatGenerationChunk({
        text: chunk.text,
        message: new AIMessageChunk({
          content: chunk.text,
          tool_call_chunks: toolCallsToLangChainChunks(chunk.toolCalls),
        }),
      });

      yield generationChunk;
      if (chunk.text) await runManager?.handleLLMNewToken(chunk.text);
    }
  }
}
