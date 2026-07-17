/**
 * Confidence bands.
 *
 * Thresholds are presentational only — the value that decides whether a question
 * becomes a knowledge gap is KNOWLEDGE_CONFIDENCE_FLOOR on the server. These
 * bands are calibrated from observed traffic: answerable questions have scored
 * ~0.55-0.57, an unanswerable one ~0.44, so "low" starts below 0.45.
 */
export const CONFIDENCE_BANDS = [
  {
    min: 0.55,
    label: "High",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  {
    min: 0.45,
    label: "Medium",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    min: 0,
    label: "Low",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
] as const;
