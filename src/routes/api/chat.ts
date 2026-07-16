import { createFileRoute } from "@tanstack/react-router";
import { type UIMessage } from "ai";
import {
  AllProvidersFailedError,
  hasConfiguredProvider,
  NoProvidersConfiguredError,
  streamChatWithFallback,
} from "@/lib/ai/gateway.server";
import { fetchTranscript } from "@/lib/transcript.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as { messages?: UIMessage[] };
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        if (!hasConfiguredProvider()) {
          return new Response(new NoProvidersConfiguredError().message, { status: 500 });
        }

        let transcript = "";
        try {
          transcript = await fetchTranscript();
        } catch (e) {
          return new Response("Could not load the policy document.", { status: 502 });
        }

        const system = `You are "Ask the Digit", an assistant that answers questions strictly using the DIGIT WEB LANKA company policy manual provided below.

Rules:
- Answer ONLY using information found in the DOCUMENT. If the answer is not present, say clearly that the policy document does not cover it.
- Be concise, professional, and structured. Use short paragraphs or bullet lists.
- After your answer, ALWAYS append a section titled exactly "Sources" as a markdown heading (## Sources). Under it, list 1-3 short verbatim excerpts from the DOCUMENT that support your answer, each as a blockquote (> ...) with the relevant section number/title if visible (e.g. "1.1 Purpose and Reasoning").
- Never invent policies, numbers, or section titles.

DOCUMENT:
"""
${transcript}
"""`;

        try {
          return await streamChatWithFallback({ system, messages });
        } catch (e) {
          if (e instanceof AllProvidersFailedError) {
            console.error(`[api/chat] ${e.message}`);
            return new Response("Every AI provider is unavailable right now.", { status: 503 });
          }
          throw e;
        }
      },
    },
  },
});
