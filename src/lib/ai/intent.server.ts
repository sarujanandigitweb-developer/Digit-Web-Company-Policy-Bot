import { retrieve } from "@/lib/services/retrieval.service";

/**
 * Classifies a chat question as general company knowledge or department-specific.
 *
 * "general"    → answerable from shared, company-wide policy (working hours,
 *                leave, conduct, dress code, holidays). Answered from shared
 *                knowledge only; no department needed.
 * "department" → operational knowledge that belongs to a specific team. Needs
 *                the user to pick a department first.
 *
 * The signal is the shared knowledge base itself: if the question has a
 * confident match in shared documents, it is general; otherwise it is treated as
 * department-specific and the user is asked to choose. This is deterministic and
 * — unlike an LLM classifier — adds no completion call and cannot be knocked out
 * by a busy provider (it reuses the same embedding search the chat already runs).
 *
 * The classification only decides whether to prompt for a department. It NEVER
 * widens a search: "general" reads shared only, and "department" reads the chosen
 * department plus shared. So the fail-safe on any error is "department" — asking
 * is always correct, since a department search also includes shared and can
 * still answer a general question.
 */
export type QuestionIntent = "general" | "department";

/**
 * Blended-score threshold above which a shared match counts as answering the
 * question. Calibrated against observed retrieval: relevant hits score ~0.5-0.6,
 * unrelated ones ~0.4. Tunable via INTENT_CONFIDENCE_FLOOR.
 */
const INTENT_FLOOR = Number(process.env.INTENT_CONFIDENCE_FLOOR ?? 0.45);

export async function classifyIntent(question: string): Promise<QuestionIntent> {
  try {
    const shared = await retrieve({ query: question, sharedOnly: true, limit: 1 });
    const topScore = shared[0]?.score ?? 0;
    return topScore >= INTENT_FLOOR ? "general" : "department";
  } catch {
    // Embedding/search failure: ask the user for a department. Safe by
    // construction — the department search includes shared, so no answer is lost.
    return "department";
  }
}
