import type { VeloxQuantModel } from './client.js';
import type { ChatMessage, ChatResponse, ResponseFormat, ToolDefinition } from './types.js';

export interface ConversationOptions {
  system?: string;
}

export interface ConversationSendOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  tools?: ToolDefinition[];
  responseFormat?: ResponseFormat;
}

/**
 * Stateful chat history over a loaded model. Appends each user/assistant
 * turn automatically so callers don't have to hand-roll a ChatMessage[] and
 * re-append it on every send() — see Agent (src/agent.ts) for the same
 * tool-call/tool-result pairing contract this composes with, one round
 * trip at a time instead of an autonomous loop.
 */
export class Conversation {
  private readonly system?: string;
  private history: ChatMessage[];

  constructor(
    private readonly model: VeloxQuantModel,
    options: ConversationOptions = {},
  ) {
    this.system = options.system;
    this.history = this.system ? [{ role: 'system', content: this.system }] : [];
  }

  get messages(): readonly ChatMessage[] {
    return this.history;
  }

  /** Appends the user turn, sends full history, appends the assistant's reply, and returns the response. */
  async send(prompt: string, options: ConversationSendOptions = {}): Promise<ChatResponse> {
    this.history.push({ role: 'user', content: prompt });

    const response = await this.model.chat({
      messages: [...this.history],
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      tools: options.tools,
      responseFormat: options.responseFormat,
    });

    this.history.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls ?? undefined,
    });

    return response;
  }

  /** Clears accumulated history, keeping the system prompt (if any). */
  reset(): void {
    this.history = this.system ? [{ role: 'system', content: this.system }] : [];
  }
}
