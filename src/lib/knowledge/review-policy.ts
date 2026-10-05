export type ReviewKind = "new" | "duplicate" | "overlap" | "conflict" | "uncertain";
export type ReviewDecision = "include" | "keep_existing" | "use_incoming" | "excerpt" | "distinct";

export interface ReviewMatch {
  chunk_id: string;
  document_id: string;
  document_title: string;
  department_id: string;
  content: string;
  heading: string | null;
  page_number: number | null;
  relation: ReviewKind;
  explanation: string;
}

export function summarizeRelations(matches: ReviewMatch[]): ReviewKind {
  for (const kind of ["conflict", "uncertain", "overlap", "duplicate"] as const) {
    if (matches.some((m) => m.relation === kind)) return kind;
  }
  return "new";
}

/** An excerpt is source text selected by a human, never model-written policy. */
export function validateDecision(input: {
  kind: ReviewKind | null;
  decision: ReviewDecision;
  content: string;
  excerpt?: string;
  note?: string;
}): string | null {
  if (!input.kind) throw new Error("Compare this passage before deciding");
  if (input.kind !== "new" && input.decision === "include") {
    throw new Error("Overlapping information needs an explicit reviewer decision");
  }
  if (input.kind !== "new" && !input.note?.trim()) {
    throw new Error("Record the reason and policy owner's confirmation for this decision");
  }
  if (input.decision === "distinct" && input.kind === "duplicate") {
    throw new Error("Equivalent content should not be indexed twice");
  }
  if (input.decision === "excerpt") {
    const excerpt = input.excerpt?.trim();
    if (!excerpt || !input.content.includes(excerpt)) {
      throw new Error("Select an exact, continuous excerpt from the incoming passage");
    }
    return excerpt;
  }
  return null;
}
