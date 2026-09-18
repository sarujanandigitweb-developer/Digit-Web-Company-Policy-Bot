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
import { knowledgeScope, requireAdminArea } from "@/lib/auth/session.server";
import { api, jsonBody } from "@/lib/http/handler";
import { resourceChatSchema } from "@/lib/validators/library";
import * as library from "@/lib/services/library.service";
import {
  buildResourceContext,
  buildResourceFollowups,
  latestQuestion,
  RESOURCE_NOT_FOUND,
} from "@/lib/services/resource-chat.server";

/**
 * /api/admin/library/chat — "Ask about this resource".
 *
 * A separate endpoint from /api/chat, for two reasons. It is authenticated,
 * where the general chatbot is public — putting a resource filter on the public
 * endpoint would make every uploaded resource readable by anyone who guessed an
 * id. And it keeps the general chatbot's code path untouched: nothing in this
 * file runs for a normal chat request, so resource mode cannot regress it.
 *
 * The resource id arrives from the browser and is NOT trusted. It is re-resolved
 * through library.getResource, which enforces status = 'active' and the caller's
 * department scope, and returns the same "not available" for an unknown id as
 * for a forbidden one. Only the id that survives that check reaches retrieval.
 */
interface ResourceChatBody {
  messages?: UIMessage[];
  resourceId?: string;
}

export const Route = createFileRoute("/api/admin/library/chat")({
  server: {
    handlers: {
      POST: api(async ({ request }) => {
        const user = await requireAdminArea(request);

        const body = (await jsonBody(request)) as ResourceChatBody;
        const messages = body.messages;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const { resourceId } = resourceChatSchema.parse({ resourceId: body.resourceId });

        // Authorisation gate. Throws 404 for unknown, inactive or out-of-scope.
        const resource = await library.getResource(resourceId, knowledgeScope(user));

        if (!hasConfiguredProvider()) {
          return new Response(new NoProvidersConfiguredError().message, { status: 500 });
        }

        const question = latestQuestion(messages);
        if (!question) return new Response("No question found in messages", { status: 400 });

        const context = await buildResourceContext({
          question,
          // resource.id, not resourceId: the value that passed the check, so a
          // later edit cannot reintroduce the unvalidated one by accident.
          documentId: resource.id,
          resourceTitle: resource.title,
        });

        const followups = buildResourceFollowups({
          chunks: context.chunks,
          confidence: context.confidence,
          answerable: context.answerable,
          resourceTitle: resource.title,
        });

        // Nothing relevant in this resource. Answered here, with no model call
        // and — mandatorily — no second search anywhere else.
        if (!context.answerable) {
          return createUIMessageStreamResponse({
            stream: createUIMessageStream({
              originalMessages: messages,
              execute: ({ writer }) => {
                writer.write({ type: "data-followups", data: followups } as UIMessageChunk);
                const id = "not-found";
                writer.write({ type: "text-start", id });
                writer.write({ type: "text-delta", id, delta: RESOURCE_NOT_FOUND });
                writer.write({ type: "text-end", id });
              },
            }),
          });
        }

        let modelStream: ReadableStream<UIMessageChunk>;
        try {
          modelStream = await streamChatBody({ system: context.system, messages });
        } catch (e) {
          if (e instanceof AllProvidersFailedError) {
            console.error(`[api/library/chat] ${e.message}`);
            return new Response("Every AI provider is unavailable right now.", { status: 503 });
          }
          throw e;
        }

        // Excerpt count only — never the ids or the scores behind them.
        console.log(`[api/library/chat] resource-scoped chunks=${context.chunks.length}`);

        return createUIMessageStreamResponse({
          stream: createUIMessageStream({
            originalMessages: messages,
            onError: (err) => {
              console.error("[api/library/chat] ui stream error:", err);
              return "Something went wrong.";
            },
            execute: ({ writer }) => {
              writer.write({ type: "data-followups", data: followups } as UIMessageChunk);
              writer.merge(modelStream);
            },
          }),
        });
      }),
    },
  },
});
