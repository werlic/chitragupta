import { type ZodType } from 'zod';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tool definition in the format that Ollama/OpenAI function calling expects.
 * @see https://ollama.com/blog/tool-support
 * @see https://platform.openai.com/docs/guides/function-calling
 */
export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
        items?: { type: string };
      }>;
      required: string[];
    };
  };
}

/**
 * A tool call that the LLM decided to make.
 */
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Result of a chat call with tools enabled.
 * The LLM may either return a text response, or one or more tool calls.
 */
export interface LLMChatWithToolsResult {
  content: string;
  toolCalls: LLMToolCall[];
}

export interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], opts?: { temperature?: number; model?: string }): Promise<string>;
  streamChat(messages: LLMMessage[], opts?: { temperature?: number; model?: string }): AsyncIterable<string>;
  // ZodType<T, any, any>: Input left unconstrained so a schema with .transform()/.preprocess()
  // (Input != Output, e.g. normalizing LLM-emitted null to undefined) still infers T correctly.
  parseJSON<T>(prompt: string, schema: ZodType<T, any, any>, systemPrompt?: string): Promise<T>;
  isAvailable(): boolean;
  /**
   * Chat with tools (function calling). The LLM can decide to call one or more
   * tools. The caller is responsible for executing the tools and optionally
   * calling chatWithTools again with the tool results.
   *
   * NOTE: This is a non-streaming call because tool calls need to be parsed
   * from the complete response.
   */
  chatWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    opts?: { temperature?: number; model?: string }
  ): Promise<LLMChatWithToolsResult>;
}

export const DEFAULT_TIMEOUT = 30000; // 30s for non-streaming requests
export const DEFAULT_STREAM_TIMEOUT = 120000; // 120s for streaming requests
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'llama3.2';
