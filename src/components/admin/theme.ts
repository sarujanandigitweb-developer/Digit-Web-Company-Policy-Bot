/**
 * The admin design system.
 *
 * Every admin page imports from here, so a change lands on all of them at once
 * and two screens cannot drift apart. Brand colours are unchanged — the navy is
 * the product's identity; what changed is the surface treatment around it.
 *
 * Spacing follows an 8px rhythm (Tailwind 2/4/6/8 = 8/16/24/32px). Container
 * radius steps up to 16px so cards read as surfaces rather than boxes.
 */

// --- brand (unchanged) ------------------------------------------------------
export const BRAND = "#15243D";
export const BRAND_2 = "#22375f";
export const ACCENT = "#2b6cf3";

/** The header gradient used across the app. */
export const HEADER_GRADIENT = `linear-gradient(90deg, ${BRAND} 0%, ${BRAND_2} 100%)`;
/** The logo/avatar tile gradient. */
export const TILE_GRADIENT = `linear-gradient(135deg, #2b4a82 0%, ${BRAND} 100%)`;

/** Chart series, ordered. Navy leads; the rest are tuned to sit beside it. */
export const CHART_COLORS = ["#15243D", "#2b6cf3", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

// --- surfaces ---------------------------------------------------------------

/** The page background, shared with the chat screen. */
export const PAGE_BG =
  "bg-[linear-gradient(180deg,#F5F7FA_0%,#FFFFFF_60%)] dark:bg-[linear-gradient(180deg,#0b1220_0%,#0f172a_60%)]";

/**
 * The standard card: 16px radius, hairline border, and a shadow cast to the
 * lower left — light from the upper right.
 *
 * Two layers do the work: a wide soft cast that reads along the left edge and
 * underneath, and a tight contact shadow that keeps the card from looking like
 * it hovers. Both share the same negative x / positive y direction, because a
 * card lit differently from its neighbour is what makes a page look assembled
 * rather than designed.
 */
export const CARD =
  "rounded-2xl border border-slate-200/80 bg-white shadow-[-4px_4px_12px_-2px_rgba(16,24,40,0.08),-1px_2px_4px_-1px_rgba(16,24,40,0.05)] dark:border-white/[0.08] dark:bg-slate-900/60 dark:shadow-[-4px_4px_12px_-2px_rgba(0,0,0,0.3),-1px_2px_4px_-1px_rgba(0,0,0,0.2)]";

/**
 * A card that responds to the pointer. The cast lengthens down-left as the card
 * rises — the light source never moves, which is what makes the lift read as
 * physical rather than as a restyle on hover.
 */
export const CARD_INTERACTIVE = `${CARD} transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[-8px_8px_20px_-4px_rgba(16,24,40,0.12),-2px_4px_8px_-2px_rgba(16,24,40,0.06)] dark:hover:border-white/20`;

/** Inset surface: code blocks, previews, anything recessed. */
export const SURFACE_SUNK =
  "rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.06]";

// --- typography -------------------------------------------------------------

export const TEXT_PAGE_TITLE =
  "text-[22px] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white";
export const TEXT_SECTION = "text-sm font-semibold text-slate-900 dark:text-slate-100";
export const TEXT_MUTED = "text-sm text-slate-500 dark:text-slate-400";
export const TEXT_SUBTLE = "text-xs text-slate-400 dark:text-slate-500";

/** Uppercase micro-label above a group. */
export const TEXT_EYEBROW =
  "text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500";

// --- interaction ------------------------------------------------------------

/** One focus treatment everywhere, so keyboard users get a consistent signal. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

/** Semantic tones. Kept apart from the brand: status must never depend on it. */
export const TONE = {
  brand: {
    fg: "text-[#15243D] dark:text-[#8FB0E8]",
    bg: "bg-[#15243D]/[0.06] dark:bg-white/[0.06]",
  },
  blue: { fg: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
  emerald: { fg: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  amber: { fg: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
  red: { fg: "text-red-600 dark:text-red-400", bg: "bg-red-500/10" },
  violet: { fg: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
  slate: { fg: "text-slate-500 dark:text-slate-400", bg: "bg-slate-500/10" },
} as const;

export type Tone = keyof typeof TONE;

/**
 * A stable colour per department name.
 *
 * Hashed rather than stored: departments are user-created, so there is no colour
 * column to read, and hashing keeps a department the same colour on every page
 * without a schema change.
 */
export function departmentTone(name: string | null | undefined): Tone {
  if (!name) return "slate";
  const tones: Tone[] = ["brand", "blue", "emerald", "amber", "violet", "red"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return tones[hash % tones.length];
}

/** Two-letter initials for a department or person avatar. */
export function initials(name: string | null | undefined): string {
  if (!name) return "—";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
