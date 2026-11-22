import crypto from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany, type LanguageModelV1 } from 'ai';
import type { AIProvider } from '@askmink/shared';
import { DEFAULT_MODELS } from '@askmink/shared';
import type { AppConfig } from '../config.js';

export interface ResolvedProviderCredentials {
  provider: AIProvider;
  apiKey: string;
  baseUrl?: string | null;
  model: string;
}

// Deterministic semantic-ish vector for local/E2E tests without external API keys.
// Supports any requested dimension (e.g. 1024 for qwen3-embedding-0.6b, 768 for gemini, etc.)
export function deterministicMockEmbedding(text: string, dimensions = 1024): number[] {
  const vec = new Float64Array(dimensions);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) {
    vec[0] = 1;
    return Array.from(vec);
  }

  for (const token of tokens) {
    const hash = crypto.createHash('sha256').update(token).digest();
    for (let i = 0; i < 4; i++) {
      const idx = hash.readUInt16BE(i * 2) % dimensions;
      const sign = (hash[8 + i]! & 1) === 0 ? 1 : -1;
      vec[idx] = (vec[idx] ?? 0) + sign;
    }
  }

  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => Number((v / norm).toFixed(6)));
}

export function resolveMockDimension(modelName: string): number {
  const match = modelName.match(/(\d{3,4})d?$/);
  if (match) {
    const parsed = Number(match[1]);
    if (parsed >= 64 && parsed <= 4096) return parsed;
  }
  if (modelName.includes('qwen3-embedding-0.6b')) return 1024;
  if (modelName.includes('text-embedding-3-small')) return 1536;
  if (modelName.includes('text-embedding-004') || modelName.includes('gemini')) return 768;
  return 1024;
}

export function buildChatModel(
  creds: ResolvedProviderCredentials,
  config: AppConfig
): LanguageModelV1 {
  switch (creds.provider) {
    case 'vercel-ai-gateway': {
      const gateway = createOpenAICompatible({
        name: 'vercel-ai-gateway',
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || config.aiGatewayBaseUrl || DEFAULT_MODELS.gatewayBaseUrl,
      });
      return gateway.chatModel(creds.model);
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || undefined,
      });
      return openai.chat(creds.model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || undefined,
      });
      return anthropic(creds.model);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || undefined,
      });
      return google(creds.model);
    }
    case 'openrouter': {
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || 'https://openrouter.ai/api/v1',
      });
      return openrouter.chatModel(creds.model);
    }
    case 'openai-compatible': {
      const compat = createOpenAICompatible({
        name: 'openai-compatible',
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || 'http://127.0.0.1:11434/v1',
      });
      return compat.chatModel(creds.model);
    }
    default:
      throw new Error(`Unsupported chat provider: ${creds.provider}`);
  }
}

export async function generateEmbeddings(
  texts: string[],
  creds: ResolvedProviderCredentials,
  config: AppConfig
): Promise<{ embeddings: number[][]; dimensions: number }> {
  if (texts.length === 0) {
    return { embeddings: [], dimensions: 0 };
  }

  if (creds.provider === 'mock') {
    if (!config.allowMockProvider) {
      throw new Error('Mock AI provider is disabled in this environment');
    }
    const dims = resolveMockDimension(creds.model);
    return {
      embeddings: texts.map((t) => deterministicMockEmbedding(t, dims)),
      dimensions: dims,
    };
  }

  if (creds.provider === 'anthropic') {
    throw new Error(
      'Anthropic does not provide an embedding API. Please configure a separate Embedding Provider Key (e.g. Vercel AI Gateway, OpenAI, Google, or Ollama).'
    );
  }

  let embeddingModel;
  switch (creds.provider) {
    case 'vercel-ai-gateway': {
      const gateway = createOpenAICompatible({
        name: 'vercel-ai-gateway',
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || config.aiGatewayBaseUrl || DEFAULT_MODELS.gatewayBaseUrl,
      });
      embeddingModel = gateway.textEmbeddingModel(creds.model);
      break;
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || undefined,
      });
      embeddingModel = openai.embedding(creds.model);
      break;
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || undefined,
      });
      embeddingModel = google.textEmbeddingModel(creds.model);
      break;
    }
    case 'openrouter': {
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || 'https://openrouter.ai/api/v1',
      });
      embeddingModel = openrouter.textEmbeddingModel(creds.model);
      break;
    }
    case 'openai-compatible': {
      const compat = createOpenAICompatible({
        name: 'openai-compatible',
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || 'http://127.0.0.1:11434/v1',
      });
      embeddingModel = compat.textEmbeddingModel(creds.model);
      break;
    }
    default:
      throw new Error(`Unsupported embedding provider: ${creds.provider}`);
  }

  if (texts.length === 1) {
    const res = await embed({ model: embeddingModel, value: texts[0]! });
    return { embeddings: [res.embedding], dimensions: res.embedding.length };
  }

  const res = await embedMany({ model: embeddingModel, values: texts });
  const dims = res.embeddings[0]?.length ?? 0;
  return { embeddings: res.embeddings, dimensions: dims };
}
