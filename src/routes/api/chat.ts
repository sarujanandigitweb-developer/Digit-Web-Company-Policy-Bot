import { createFileRoute } from "@tanstack/react-router";
import { type UIMessage } from "ai";
import {
  AllProvidersFailedError,
  hasConfiguredProvider,
  NoProvidersConfiguredError,
  streamChatWithFallback,
} from "@/lib/ai/gateway.server";
import { fetchTranscript } from "@/lib/transcript.server";
import {
  buildKnowledgeContext,
  latestQuestion,
  recordExchange,
  resolveDepartment,
  RETRIEVAL_ENABLED,
} from "@/lib/services/chat-knowledge.server";

interface ChatRequestBody {
  messages?: UIMessage[];
  /** Department slug or id. Absent/"all" means search every department. */
  departmentId?: string | null;
  sessionId?: string | null;
}

/**
 * The chat endpoint.
 *
 * Answers from the knowledge base: the question is embedded, chunks are
 * retrieved (department-first, or global), and only those excerpts reach the
 * model. Previously an entire Google Drive document was inlined into every
 * prompt, which is why documents uploaded via the admin console never appeared
 * in answers.
 *
 * KNOWLEDGE_SOURCE=transcript restores the old behaviour without a deploy.
 *
 * The provider fallback chain and the streaming response shape are unchanged —
 * the frontend contract is identical apart from two optional request fields.
 */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
        const messages = body.messages;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        if (!hasConfiguredProvider()) {
          return new Response(new NoProvidersConfiguredError().message, { status: 500 });
        }

        if (!RETRIEVAL_ENABLED) return legacyTranscriptAnswer(messages);

        const question = latestQuestion(messages);
        if (!question) return new Response("No question found in messages", { status: 400 });

        // "all" (or nothing) is a global search. An unknown slug also resolves to
        // null rather than erroring — a stale picker value should widen the
        // search, not break the chat.
        const requested =
          body.departmentId && body.departmentId !== "all" ? body.departmentId : null;
        const departmentId = await resolveDepartment(requested);
        const globalSearch = departmentId === null;

        let context;
        try {
          context = await buildKnowledgeContext({ question, departmentId, globalSearch });
        } catch (error) {
          console.error("[api/chat] retrieval failed:", error);
          return new Response("Could not search the knowledge base.", { status: 502 });
        }

        const startedAt = Date.now();
        let response: Response;
        try {
          response = await streamChatWithFallback({ system: context.system, messages });
        } catch (e) {
          if (e instanceof AllProvidersFailedError) {
            console.error(`[api/chat] ${e.message}`);
            return new Response("Every AI provider is unavailable right now.", { status: 503 });
          }
          throw e;
        }

        console.log(
          `[api/chat] scope=${context.scope} chunks=${context.chunks.length} ` +
            `confidence=${context.confidence.toFixed(3)}`,
        );

        // Tee the stream: one copy goes to the browser untouched, the other is
        // read here to capture the finished answer. Without the tee we would have
        // to buffer the whole reply before sending it, which would kill streaming.
        const [toClient, toRecorder] = (response.body ?? new ReadableStream()).tee();

        void collectAnswer(toRecorder)
          .then((answer) =>
            recordExchange({
              sessionId: body.sessionId ?? null,
              question,
              answer,
              context,
              globalSearch,
              responseMs: Date.now() - startedAt,
            }),
          )
          .catch((error) => console.error("[api/chat] recording failed:", error));

        return new Response(toClient, {
          status: response.status,
          headers: response.headers,
        });
      },
    },
  },
});

/** Reassembles the assistant's text from the UI message stream. */
async function collectAnswer(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are newline-delimited; keep the trailing partial line.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const chunk = JSON.parse(line.slice(6)) as { type?: string; delta?: string };
        if (chunk.type === "text-delta" && chunk.delta) answer += chunk.delta;
      } catch {
        // Non-JSON keepalives and [DONE] markers are expected.
      }
    }
  }
  return answer;
}

/** The pre-retrieval behaviour, kept behind KNOWLEDGE_SOURCE=transcript. */
async function legacyTranscriptAnswer(messages: UIMessage[]): Promise<Response> {
  let transcript = "";
  try {
    transcript = await fetchTranscript();
  } catch {
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
}
