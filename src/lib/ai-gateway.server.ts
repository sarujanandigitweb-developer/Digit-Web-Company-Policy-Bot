import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

// Lovable injects LOVABLE_API_KEY in its hosted environment but not locally, so
// fall back to a direct Google key for local dev.
export function resolveChatModel(): LanguageModel | null {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    return createLovableAiGatewayProvider(lovableKey)("google/gemini-3-flash-preview");
  }

  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleKey) {
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    return google(process.env.GOOGLE_MODEL ?? "gemini-2.0-flash");
  }

  return null;
}
