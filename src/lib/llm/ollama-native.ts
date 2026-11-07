import { type ZodType } from 'zod';
import type { LLMProvider, LLMMessage, LLMToolDefinition, LLMChatWithToolsResult, LLMToolCall } from './provider';
import { DEFAULT_MODEL } from './provider';

/**
 * Ollama native API provider — uses /api/chat instead of OpenAI-compatible endpoint.
 * This avoids issues with thinking models (qwen3.5, etc.) where `think: false`
 * is not supported on the OpenAI-compatible endpoint.
 *
 * Also supports native tool/function calling via the `tools` parameter.
 * @see https://ollama.com/blog/tool-support
 */
export class OllamaNativeProvider implements LLMProvider {
  name = 'Ollama (native)';
  private baseURL: string;
  private model: string;

  constructor() {
    // Strip trailing /v1 if present — native API uses /api/chat not /v1/chat/completions
    const rawURL = process.env.OPENAI_BASE_URL || 'http://localhost:11434';
    this.baseURL = rawURL.replace(/\/v1\/?$/, '');
    this.model = DEFAULT_MODEL;
  }

  isAvailable(): boolean {
    return true; // Always available if constructed — health check will verify
  }

  async chat(messages: LLMMessage[], opts?: { temperature?: number; model?: string }): Promise<string> {
    const res = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts?.model || this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        think: false,
        options: {
          temperature: opts?.temperature ?? 0.3,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return data?.message?.content || '';
  }

  async *streamChat(messages: LLMMessage[], opts?: { temperature?: number; model?: string }): AsyncIterable<string> {
    const res = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts?.model || this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        think: false,
        options: {
          temperature: opts?.temperature ?? 0.3,
        },
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Ollama stream error: ${res.status} ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          const content = json?.message?.content;
          if (content) yield content;
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer.trim());
        const content = json?.message?.content;
        if (content) yield content;
      } catch {
        // Ignore
      }
    }
  }

  async parseJSON<T>(prompt: string, schema: ZodType<T, any, any>, systemPrompt?: string): Promise<T> {
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
   * Chat with tools using Ollama's native `tools` parameter.
   * Ollama returns tool_calls in the message when the model decides to call a function.
   */
  async chatWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    opts?: { temperature?: number; model?: string }
  ): Promise<LLMChatWithToolsResult> {
    const res = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts?.model || this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        think: false,
        tools: tools.map(t => ({
          type: 'function',
          function: t.function,
        })),
        options: {
          temperature: opts?.temperature ?? 0.3,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error (tools): ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const msg = data?.message;

    // Extract tool calls from Ollama response format
    const toolCalls: LLMToolCall[] = [];
    if (msg?.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fnName = tc?.function?.name || tc?.name;
        const fnArgs = typeof tc?.function?.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc?.function?.arguments || tc?.arguments || {});
        if (fnName) {
          toolCalls.push({
            id: tc?.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
              name: fnName,
              arguments: fnArgs,
            },
          });
        }
      }
    }

    return {
      content: msg?.content || '',
      toolCalls,
    };
  }

  private extractJSON(text: string): string {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return jsonMatch[1].trim();
    const objMatch = text.match(/[\[{][\s\S]*[\]}]/);
    if (objMatch) return objMatch[0];
    return text.trim();
  }
}
