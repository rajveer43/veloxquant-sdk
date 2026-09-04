import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
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
 * Wraps an already-loaded VeloxQuantModel as a LangChain.js BaseChatModel,
 * usable with LCEL chains, agents, etc. Takes a running VeloxQuantModel
 * (not a bare model-name string) for the same reason as veloxquant() in
 * src/ai-sdk.ts: model loading is async (vq.load()) and this SDK doesn't
 * own a disposal hook to call model.stop() on its own, so lifecycle stays
 * in the caller's hands.
 *
 * Streaming (`_streamResponseChunks`) is not implemented — invoke()/LCEL
 * chains work, but `.stream()` falls back to buffering the full invoke()
 * result rather than truly streaming tokens (see the base BaseChatModel
 * behavior with disableStreaming unset: it uses _generate() when no
 * streaming override exists).
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
}
