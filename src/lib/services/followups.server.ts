import { sql } from "@/lib/db/client.server";
import { CONFIDENCE_FLOOR, type KnowledgeContext } from "./chat-knowledge.server";
import type { RetrievedChunk } from "./retrieval.service";

/**
 * Post-answer follow-up data, built entirely from the chunks that were already
 * retrieved for the answer — no second vector search. Everything here is grounded
 * in those chunks: suggestions come from their headings, sources from their
 * documents, chips from their topics. Nothing is invented.
 *
 * Delivered as a data part on the answer stream (see routes/api/chat.ts), so the
 * frontend gets it without an extra request.
 */

export type ConfidenceLevel = "high" | "medium" | "low";

export interface SourceDocument {
  id: string;
  title: string;
  department: string;
  version: number;
  updated_at: string;
}

export interface FollowupData {
  /** 3–5 short related questions, each < 80 chars, grounded in the chunks. */
  suggestions: string[];
  /** The documents the answer drew on, for the "sources" card. */
  documents: SourceDocument[];
  /** Short topic chips derived from chunk headings. */
  chips: string[];
  confidence: ConfidenceLevel;
  scope: KnowledgeContext["scope"];
  /** True when nothing confident was found — the UI offers a gap prompt instead. */
  lowConfidence: boolean;
}

function levelFor(confidence: number): ConfidenceLevel {
  if (confidence >= 0.6) return "high";
  if (confidence >= CONFIDENCE_FLOOR) return "medium";
  return "low";
}

/** Strips leading bullets, section numbers, markdown and a trailing colon:
 *  "6.2 Planned Leave" → "Planned Leave", "● 2:00 PM:" → "2:00 PM". */
function cleanHeading(heading: string): string {
  return heading
    .replace(/^[\s●•‣▪◦·*\-–—]+/, "")
    .replace(/^\d{1,2}(?:\.\d{1,2})*\s+/, "")
    .replace(/\*+/g, "")
    .replace(/:\s*$/, "")
    .trim();
}

/**
 * Whether a cleaned heading reads as a real topic rather than a schedule or
 * fragment. Rejects times, bare numbers and symbol-led text so a chip never
 * shows "● 2:00 PM – 3:00 PM".
 */
function isTopicPhrase(t: string): boolean {
  if (t.length < 4 || t.length > 48) return false;
  if (/\d{1,2}:\d{2}/.test(t)) return false; // clock times
  if (/\b(am|pm)\b/i.test(t)) return false; // AM/PM schedules
  if (/^[^A-Za-z]/.test(t)) return false; // must start with a letter
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  return letters >= t.length * 0.6; // mostly words, not numbers/punctuation
}

/**
 * Distinct topic phrases from the chunks, most-relevant first. Headings are the
 * best signal; where a chunk has no usable heading, the document title stands in.
 */
function topics(chunks: RetrievedChunk[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks) {
    const candidate = chunk.heading ? cleanHeading(chunk.heading) : "";
    const topic = isTopicPhrase(candidate) ? candidate : chunk.document_title.trim();
    if (!topic || topic.length > 48) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
  }
  return out;
}

/**
 * Turns the retrieved topics into short follow-up questions.
 *
 * Deliberately deterministic — no LLM call. It reuses only the retrieved context
 * (Feature 7), always produces something (Feature 8: updates every answer), and
 * cannot invent a topic that was not retrieved. Questions are kept under 80
 * characters and phrased against the actual heading text.
 */
function suggestionsFor(chunks: RetrievedChunk[]): string[] {
  const out: string[] = [];
  const push = (q: string) => {
    if (q.length <= 80 && !out.includes(q)) out.push(q);
  };

  for (const topic of topics(chunks)) {
    if (out.length >= 5) break;
    const lower = topic.toLowerCase();
    // Light phrasing so it reads as a question rather than a heading echo.
    if (/policy|guidelines?|rules?|procedure|process/i.test(topic)) {
      push(`What does the ${topic} say?`);
    } else if (/leave|holiday|attendance|payroll|benefit|salary/i.test(lower)) {
      push(`Tell me more about ${topic}.`);
    } else {
      push(`How does ${topic} work?`);
    }
  }
  return out.slice(0, 5);
}

/** Loads version/updated metadata for the documents behind the chunks. */
async function loadDocuments(chunks: RetrievedChunk[]): Promise<SourceDocument[]> {
  // Distinct document ids in relevance order (first appearance wins).
  const order: string[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (!seen.has(c.document_id)) {
      seen.add(c.document_id);
      order.push(c.document_id);
    }
  }
  if (order.length === 0) return [];

  // A plain indexed lookup by id — not a vector search.
  const rows = (await sql`
    SELECT d.id, d.title, dep.name AS department, d.version, d.updated_at
      FROM knowledge_documents d
      LEFT JOIN departments dep ON dep.id = d.department_id
     WHERE d.id = ANY(${order}::uuid[])
  `) as SourceDocument[];

  const byId = new Map(rows.map((r) => [r.id, r]));
  return order.map((id) => byId.get(id)).filter((d): d is SourceDocument => !!d);
}

export async function buildFollowups(context: KnowledgeContext): Promise<FollowupData> {
  const { chunks, confidence, scope } = context;
  const lowConfidence = confidence < CONFIDENCE_FLOOR || chunks.length === 0;

  if (lowConfidence) {
    return {
      suggestions: [],
      documents: [],
      chips: [],
      confidence: "low",
      scope,
      lowConfidence: true,
    };
  }

  const documents = await loadDocuments(chunks);

  return {
    suggestions: suggestionsFor(chunks),
    documents,
    chips: topics(chunks).slice(0, 5),
    confidence: levelFor(confidence),
    scope,
    lowConfidence: false,
  };
}
