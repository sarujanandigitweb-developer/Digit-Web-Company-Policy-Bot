import { createFileRoute } from "@tanstack/react-router";
import { sql } from "@/lib/db/client.server";
import { classifyIntent } from "@/lib/ai/intent.server";

/**
 * /api/chat/intent — routes the first question of a conversation.
 *
 * Public (the chat has no login). Given a question with no department chosen
 * yet, it decides whether to answer from shared knowledge directly or to ask the
 * user which department they mean. Kept separate from /api/chat so the streaming
 * chat contract is unchanged — the frontend calls this first, then streams.
 *
 * Returns:
 *   { mode: "general" }
 *   { mode: "department_required", departments: [{ slug, name }] }
 *
 * The department list excludes shared/system departments, exactly like the chat
 * picker, so the user is never offered the hidden Shared department.
 */
interface IntentBody {
  question?: string;
}

export const Route = createFileRoute("/api/chat/intent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as IntentBody;
        const question = (body.question ?? "").trim();
        if (question.length < 2) {
          return json({ error: "A question is required" }, 400);
        }

        const intent = await classifyIntent(question);

        if (intent === "general") {
          return json({ mode: "general" });
        }

        const departments = await sql`
          SELECT slug, name
            FROM departments
           WHERE status = 'active' AND is_shared = false
           ORDER BY name
        `;
        return json({ mode: "department_required", departments });
      },
    },
  },
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
