import { getLLMProvider } from '@/lib/llm';

export type LLMMode = 'mock' | 'ollama' | 'openai';

const LABEL: Record<LLMMode, string> = {
  mock: 'Mock (demo)',
  ollama: 'Ollama (lokal)',
  openai: 'OpenAI-compatible',
};

/**
 * Provider the chat is using, for the "Mode: …" badge. Reads the cached provider
 * (no health check); a provider that failed its last health check is already Mock.
 */
export function llmMode(): { mode: LLMMode; modeLabel: string } {
  let name = '';
  try {
    name = getLLMProvider().name;
  } catch {
    name = '';
  }
  const mode: LLMMode = /ollama/i.test(name) ? 'ollama' : /openai/i.test(name) ? 'openai' : 'mock';
  return { mode, modeLabel: LABEL[mode] };
}
