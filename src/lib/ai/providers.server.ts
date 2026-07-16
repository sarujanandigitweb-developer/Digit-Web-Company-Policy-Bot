import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type ProviderId = "lovable" | "gemini" | "groq" | "openrouter";

export interface ProviderDefinition {
  id: ProviderId;
  /** Env var holding the credential. Providers without one are skipped. */
  apiKeyEnv: string;
  /** Env var overriding `defaultModel`. */
  modelEnv: string;
  defaultModel: string;
  createModel: (apiKey: string, modelId: string) => LanguageModel;
}

/**
 * Fallback order: the gateway walks this top to bottom and answers with the
 * first provider that both has a key and responds.
 *
 * `lovable` and `gemini` are two transports for the same Gemini models. Lovable
 * injects LOVABLE_API_KEY in its hosted environment but not locally, so the
 * direct Google key remains the local-dev path — and now also the first
 * fallback if the hosted gateway is down.
 *
 * To add a provider, append an entry. Groq and OpenRouter both speak the OpenAI
 * protocol, so they need no extra dependency; anything else OpenAI-compatible
 * only needs its baseURL.
 */
export const PROVIDER_CHAIN: ProviderDefinition[] = [
  {
    id: "lovable",
    apiKeyEnv: "LOVABLE_API_KEY",
    modelEnv: "LOVABLE_MODEL",
    defaultModel: "google/gemini-3-flash-preview",
    createModel: (apiKey, modelId) =>
      createOpenAICompatible({
        name: "lovable",
        baseURL: "https://ai.gateway.lovable.dev/v1",
        headers: { "Lovable-API-Key": apiKey },
      })(modelId),
  },
  {
    id: "gemini",
    apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    modelEnv: "GOOGLE_MODEL",
    defaultModel: "gemini-3-flash-preview",
    createModel: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
  },
  {
    id: "groq",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
    createModel: (apiKey, modelId) =>
      createOpenAICompatible({
        name: "groq",
        baseURL: "https://api.groq.com/openai/v1",
        headers: { Authorization: `Bearer ${apiKey}` },
      })(modelId),
  },
  {
    id: "openrouter",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    // A `:free` model, since free-tier keys cannot call paid ones. Free capacity
    // is shared and rate-limits often, which is why this sits last in the chain.
    defaultModel: "nvidia/nemotron-3-nano-30b-a3b:free",
    createModel: (apiKey, modelId) =>
      createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        headers: { Authorization: `Bearer ${apiKey}` },
      })(modelId),
  },
];

export interface ResolvedProvider {
  id: ProviderId;
  modelId: string;
  model: LanguageModel;
}

/**
 * The configured providers, in fallback order. Reads keys from the environment
 * at call time so a key added to .env needs only a server restart.
 */
export function resolveProviderChain(env: NodeJS.ProcessEnv = process.env): ResolvedProvider[] {
  const chain: ResolvedProvider[] = [];
  for (const def of PROVIDER_CHAIN) {
    const apiKey = env[def.apiKeyEnv];
    if (!apiKey) continue;
    const modelId = env[def.modelEnv] || def.defaultModel;
    chain.push({ id: def.id, modelId, model: def.createModel(apiKey, modelId) });
  }
  return chain;
}

/** Env var names for every known provider — used to explain an empty chain. */
export function knownApiKeyEnvNames(): string[] {
  return PROVIDER_CHAIN.map((p) => p.apiKeyEnv);
}
