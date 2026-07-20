import { createFileRoute } from "@tanstack/react-router";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import {
  AllProvidersFailedError,
  hasConfiguredProvider,
  NoProvidersConfiguredError,
  streamChatBody,
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
import { buildFollowups } from "@/lib/services/followups.server";

interface ChatRequestBody {
  messages?: UIMessage[];
  /** Department slug or id. Absent/"all" means search every department. */
  departmentId?: string | null;
  /** General question with no department chosen yet: search shared knowledge
   *  only. Takes precedence over departmentId. */
  sharedOnly?: boolean;
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

        // Shared-only (a general question before a department is chosen) wins:
        // no department, no global. Otherwise resolve the department; an unknown
        // slug resolves to null. "all"/nothing without sharedOnly stays global,
        // which preserves admin/explicit-All backend support.
        const sharedOnly = body.sharedOnly === true;
        const requested =
          !sharedOnly && body.departmentId && body.departmentId !== "all"
            ? body.departmentId
            : null;
        const departmentId = sharedOnly ? null : await resolveDepartment(requested);
        const globalSearch = !sharedOnly && departmentId === null;

        let context;
        try {
          context = await buildKnowledgeContext({
            question,
            departmentId,
            globalSearch,
            sharedOnly,
          });
        } catch (error) {
          console.error("[api/chat] retrieval failed:", error);
          return new Response("Could not search the knowledge base.", { status: 502 });
        }

        const startedAt = Date.now();
        let modelStream: ReadableStream<UIMessageChunk>;
        try {
          modelStream = await streamChatBody({ system: context.system, messages });
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

        // One copy of the model stream is merged into the response for the
        // browser; the other is read here to capture the finished answer for
        // recording. tee() lets both consume the same bytes independently.
        const [forClient, forRecord] = modelStream.tee();

        // The follow-up data part is built from the SAME retrieved context — no
        // second vector search — and written into the answer's message. Its
        // position in the stream does not dictate where the UI shows it; the
        // frontend reads it from message.parts and renders it under the answer.
        const uiStream = createUIMessageStream({
          originalMessages: messages,
          onError: (err) => {
            console.error("[api/chat] ui stream error:", err);
            return "Something went wrong.";
          },
          execute: async ({ writer }) => {
            try {
              const followups = await buildFollowups(context);
              writer.write({ type: "data-followups", data: followups } as UIMessageChunk);
            } catch (err) {
              console.error("[api/chat] follow-up build failed:", err);
            }
            // merge() forwards the model's message framing correctly — the answer
            // streams exactly as before.
            writer.merge(forClient);
          },
        });

        void collectAnswer(forRecord)
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

        return createUIMessageStreamResponse({ stream: uiStream });
      },
    },
  },
});

/** Reassembles the assistant's text from the UI-message chunk stream. */
async function collectAnswer(stream: ReadableStream<UIMessageChunk>): Promise<string> {
  const reader = stream.getReader();
  let answer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "text-delta" && value.delta) answer += value.delta;
    }
  } finally {
    reader.releaseLock();
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
