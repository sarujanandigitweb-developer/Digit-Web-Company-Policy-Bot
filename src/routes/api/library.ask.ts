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
} from "@/lib/ai/gateway.server";
import { requireAuth } from "@/lib/auth/session.server";
import { api, jsonBody } from "@/lib/http/handler";
import { askDocumentSchema } from "@/lib/validators/library-drive";
import { resolveDocument } from "@/lib/services/google-library.server";
import { buildDocumentContext, DOCUMENT_NOT_FOUND } from "@/lib/services/library-ai.server";

/**
 * /api/library/ask — "Ask this document".
 *
 * Isolated from /api/chat and /api/admin/library/chat: this is the third,
 * separate answer path in the app, and the only one grounded in a live Google
 * Drive document rather than anything in Postgres. It shares nothing with
 * either — no retrieval.service.ts, no knowledge_chunks, no department/shared
 * scope, no knowledge gap recording.
 *
 * `driveFileId` in the request body is actually our tree node id (kept as the
 * field name the requirement specified); it is re-resolved through
 * resolveDocument on every call, which is what makes single-document isolation
 * structural rather than trusted: the ONLY document text that can ever enter
 * the prompt is whatever that lookup returns for THIS id, on THIS request.
 * There is no session-held "current document" on the server to drift out of
 * sync with what the client thinks is selected.
 */
interface AskBody {
  messages?: UIMessage[];
  driveFileId?: string;
}

export const Route = createFileRoute("/api/library/ask")({
  server: {
    handlers: {
      POST: api(async ({ request }) => {
        await requireAuth(request);

        const body = (await jsonBody(request)) as AskBody;
        const messages = body.messages;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }
        const { driveFileId } = askDocumentSchema.parse({ driveFileId: body.driveFileId });

        const resolved = await resolveDocument(driveFileId);
        if (!resolved) return new Response("This document is not available", { status: 404 });

        if (!hasConfiguredProvider()) {
          return new Response(new NoProvidersConfiguredError().message, { status: 500 });
        }

        const question = latestQuestion(messages);
        if (!question) return new Response("No question found in messages", { status: 400 });

        const context = buildDocumentContext({
          documentName: resolved.node.name,
          documentText: resolved.content.text,
          question,
        });

        if (!context.answerable) {
          return notFoundStream(messages);
        }

        let modelStream: ReadableStream<UIMessageChunk>;
        try {
          modelStream = await streamChatBody({
            system: context.system,
            messages,
            providerOptions: documentQaProviderOptions(),
          });
        } catch (e) {
          if (e instanceof AllProvidersFailedError) {
            console.error(`[api/library/ask] ${e.message}`);
            return new Response("Every AI provider is unavailable right now.", { status: 503 });
          }
          throw e;
        }

        return createUIMessageStreamResponse({
          stream: createUIMessageStream({
            originalMessages: messages,
            onError: (err) => {
              console.error("[api/library/ask] ui stream error:", err);
              return "Something went wrong.";
            },
            execute: ({ writer }) => writer.merge(modelStream),
          }),
        });
      }),
    },
  },
});

/**
 * Gemini 3 "thinks" before answering, and the default budget is enormous for
 * this job: measured on a document Q&A, 334-863 hidden reasoning tokens to
 * produce an 11-token answer, taking 4-9 s to the first word. Answering from
 * text that is already in the prompt needs no deliberation — `minimal` gave the
 * same answers with the first word in ~1.3 s.
 *
 * Only sent when the configured model is a Gemini 3 model. thinkingLevel is a
 * Gemini 3 setting; an older model rejects it with a 400, and the gateway
 * treats a 400 as "every provider would reject this" and stops the whole
 * chain — so an unguarded option would turn a config change into an outage.
 * Other providers ignore options keyed under `google`.
 */
function documentQaProviderOptions() {
  const model = process.env.GOOGLE_MODEL || "gemini-3-flash-preview";
  if (!model.startsWith("gemini-3")) return undefined;
  return { google: { thinkingConfig: { thinkingLevel: "minimal" as const } } };
}

function latestQuestion(
  messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = (message.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}

function notFoundStream(messages: UIMessage[]): Response {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      originalMessages: messages,
      execute: ({ writer }) => {
        const id = "not-found";
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: DOCUMENT_NOT_FOUND });
        writer.write({ type: "text-end", id });
      },
    }),
  });
}
