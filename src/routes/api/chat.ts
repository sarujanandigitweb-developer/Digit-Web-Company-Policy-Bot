import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { resolveChatModel } from "@/lib/ai-gateway.server";
import { fetchTranscript } from "@/lib/transcript.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as { messages?: UIMessage[] };
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const model = resolveChatModel();
        if (!model) {
          return new Response(
            "No AI provider key. Set LOVABLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.",
            { status: 500 },
          );
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

        const result = streamText({
          model,
          system,
          messages: convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});