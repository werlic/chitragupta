import type { LLMProvider } from './provider';
import { OllamaNativeProvider } from './ollama-native';
import { OpenAICompatibleProvider } from './openai-compatible';
import { MockLLMProvider } from './mock';

let _provider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (_provider) return _provider;

  // Explicit choice: LLM_PROVIDER=mock | ollama | openai (tests force mock, no health check)
  const forced = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
  if (forced === 'mock') return (_provider = new MockLLMProvider());
  if (forced === 'ollama') return (_provider = new OllamaNativeProvider());
  if (forced === 'openai') {
    const realProvider = new OpenAICompatibleProvider();
    return (_provider = realProvider.isAvailable() ? realProvider : new MockLLMProvider());
  }

  // Priority 1: If OPENAI_BASE_URL points to Ollama (default or explicit), use native API
  const baseURL = process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1';
  const isOllama = baseURL.includes('localhost:11434') || baseURL.includes('127.0.0.1:11434');

  if (isOllama) {
    // Use native Ollama API — supports think:false for thinking models (qwen3.5, etc.)
    _provider = new OllamaNativeProvider();
  } else if (process.env.OPENAI_BASE_URL) {
    // Use OpenAI-compatible API for cloud providers
    const realProvider = new OpenAICompatibleProvider();
    _provider = realProvider.isAvailable() ? realProvider : new MockLLMProvider();
  } else {
    // No URL set — try Ollama default, fallback to Mock
    _provider = new OllamaNativeProvider();
  }

  return _provider;
}

export async function getLLMProviderAsync(): Promise<LLMProvider> {
  let provider = getLLMProvider();

  // Quick health check for real provider — use lightweight /api/tags endpoint for Ollama
  if (provider.name !== 'Mock (demo mode)') {
    try {
      const isOllamaNative = provider.name === 'Ollama (native)';
      const baseURL = process.env.OPENAI_BASE_URL || 'http://localhost:11434';
      const healthURL = isOllamaNative
        ? baseURL.replace(/\/v1\/?$/, '') + '/api/tags'
        : baseURL.replace(/\/v1\/?$/, '') + '/v1/models';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(healthURL, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    } catch {
      console.warn('[LLM] Provider unreachable — falling back to Mock');
      _provider = new MockLLMProvider();
      provider = _provider;
    }
  }
  return provider;
}

export type { LLMProvider, LLMMessage } from './provider';
