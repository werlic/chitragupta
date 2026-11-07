import OpenAI from 'openai';
import { type ZodType } from 'zod';
import type { LLMProvider, LLMMessage, LLMToolDefinition, LLMChatWithToolsResult, LLMToolCall } from './provider';
import { DEFAULT_MODEL, DEFAULT_TIMEOUT } from './provider';

export class OpenAICompatibleProvider implements LLMProvider {
  name = 'OpenAI-compatible';
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1',
      apiKey: process.env.OPENAI_API_KEY || 'ollama',
      timeout: DEFAULT_TIMEOUT,
    });
    this.model = DEFAULT_MODEL;
  }

  isAvailable(): boolean {
    return !!process.env.OPENAI_BASE_URL;
  }

  async chat(messages: LLMMessage[], opts?: { temperature?: number; model?: string }): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: opts?.model || this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts?.temperature ?? 0.3,
      think: false,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    const choice = res.choices[0];
    if (!choice) return '';
    // Handle thinking models (qwen3.5, etc.) — content may be empty, reasoning has the text
    const content = (choice.message as any).content || '';
    const reasoning = (choice.message as any).reasoning || '';
    return content || reasoning || '';
  }

  async *streamChat(messages: LLMMessage[], opts?: { temperature?: number; model?: string }): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: opts?.model || this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts?.temperature ?? 0.3,
      stream: true,
      think: false,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      // Handle thinking models — delta may have content and/or reasoning
      const delta = (choice.delta as any);
      const content = delta?.content || '';
      const reasoning = delta?.reasoning || '';
      if (content) yield content;
      else if (reasoning) yield reasoning;
    }
  }

  async parseJSON<T>(prompt: string, schema: ZodType<T>, systemPrompt?: string): Promise<T> {
    const messages: LLMMessage[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user', content: prompt },
    ];

    // First attempt
    const raw = await this.chat(messages, { temperature: 0.1 });
    const first = this.parseAndValidate(this.extractJSON(raw), schema);
    if (first.success) return first.data;

    // Retry once with error feedback — also covers a response that wasn't valid JSON at all
    const retryMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `JSON parse error: ${first.message}. Please fix and return valid JSON matching the schema.`,
      },
    ];
    const raw2 = await this.chat(retryMessages, { temperature: 0.1 });
    const second = this.parseAndValidate(this.extractJSON(raw2), schema);
    if (second.success) return second.data;

    throw new Error(`LLM JSON parse failed after retry: ${second.message}`);
  }

  /** JSON.parse + schema check as one non-throwing step, so malformed JSON (not just a schema mismatch) also triggers the retry above. */
  private parseAndValidate<T>(jsonStr: string, schema: ZodType<T, any, any>): { success: true; data: T } | { success: false; message: string } {
    let value: unknown;
    try {
      value = JSON.parse(jsonStr);
    } catch (err) {
      return { success: false, message: `invalid JSON (${err instanceof Error ? err.message : String(err)})` };
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return { success: true, data: parsed.data };
    return { success: false, message: parsed.error.issues[0]?.message ?? 'schema validation failed' };
  }

  /**
   * Chat with tools using OpenAI-compatible function calling.
   * Uses the standard `tools` parameter from the OpenAI API spec.
   */
  async chatWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    opts?: { temperature?: number; model?: string }
  ): Promise<LLMChatWithToolsResult> {
    const res = await this.client.chat.completions.create({
      model: opts?.model || this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map(t => ({
        type: 'function' as const,
        function: t.function,
      })),
      temperature: opts?.temperature ?? 0.3,
      think: false,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const choice = res.choices[0];
    if (!choice) return { content: '', toolCalls: [] };

    const msg = choice.message as any;
    const content = msg.content || msg.reasoning || '';

    const toolCalls: LLMToolCall[] = [];
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        toolCalls.push({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '{}',
          },
        });
      }
    }

    return {
      content,
      toolCalls,
    };
  }

  private extractJSON(text: string): string {
    // Extract JSON from markdown code blocks or raw
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return jsonMatch[1].trim();
    // Try to find JSON object/array
    const objMatch = text.match(/[\[{][\s\S]*[\]}]/);
    if (objMatch) return objMatch[0];
    return text.trim();
  }
}
