/**
 * Design tokens lifted from the existing chatbot UI (routes/index.tsx) so the
 * admin screens and the chat screen stay one visual system rather than two that
 * merely resemble each other.
 */
export const BRAND = "#15243D";
export const BRAND_2 = "#22375f";
export const ACCENT = "#2b6cf3";

/** The header gradient used across the app. */
export const HEADER_GRADIENT = `linear-gradient(90deg, ${BRAND} 0%, ${BRAND_2} 100%)`;
/** The logo/avatar tile gradient. */
export const TILE_GRADIENT = `linear-gradient(135deg, #2b4a82 0%, ${BRAND} 100%)`;
/** The page background used by the chat screen. */
export const PAGE_BG =
  "bg-[linear-gradient(180deg,#F5F7FA_0%,#FFFFFF_60%)] dark:bg-[linear-gradient(180deg,#0b1220_0%,#0f172a_60%)]";
/** The card treatment used by chat message bubbles. */
export const CARD =
  "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900/70";
