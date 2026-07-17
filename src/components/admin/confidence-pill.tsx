import { CONFIDENCE_BANDS } from "./confidence";

/**
 * Retrieval confidence as a labelled pill.
 *
 * Shared so a score means the same thing on every screen, and so the bands live
 * in one place rather than being re-guessed per page.
 */
export function ConfidencePill({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">—</span>;
  const band =
    CONFIDENCE_BANDS.find((b) => value >= b.min) ?? CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${band.className}`}
      title={`${band.label} confidence`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {value.toFixed(2)}
    </span>
  );
}
