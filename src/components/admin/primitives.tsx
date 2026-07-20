import { Link } from "@tanstack/react-router";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CARD,
  CARD_INTERACTIVE,
  departmentTone,
  FOCUS_RING,
  initials,
  TEXT_MUTED,
  TEXT_PAGE_TITLE,
  TEXT_SECTION,
  TONE,
  type Tone,
} from "./theme";

/**
 * Shared page furniture.
 *
 * These exist so every page gets the same header rhythm, the same KPI card and
 * the same avatar without each one re-inventing them — and so a change here
 * lands on all of them.
 */

/** Page title, description and an optional action slot. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className={TEXT_PAGE_TITLE}>{title}</h1>
        {description && <p className={`mt-1 ${TEXT_MUTED}`}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A titled block of content with an optional right-hand action. */
export function Section({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={TEXT_SECTION}>{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface KpiProps {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  /** Short context under the metric, e.g. "of 12 total". */
  hint?: string;
  /** Signed change. Rendered only when supplied — never inferred. */
  trend?: { value: number; label: string } | null;
  /** Turns the card into a link with an affordance. */
  to?: string;
  linkLabel?: string;
  onClick?: () => void;
  /** Renders as pressed — used where a KPI doubles as a filter. */
  active?: boolean;
}

/**
 * The KPI card.
 *
 * `trend` is optional and never fabricated: a card only shows movement when the
 * caller has a real prior value to compare against. An invented "+1 today" is
 * worse than no trend at all.
 */
export function Kpi({
  label,
  value,
  icon: Icon,
  tone = "slate",
  hint,
  trend,
  to,
  linkLabel,
  onClick,
  active,
}: KpiProps) {
  const t = TONE[tone];
  const interactive = !!to || !!onClick;

  const body = (
    <>
      {/* Icon leads, label beside it, metric beneath — the icon anchors the card
          rather than floating in the corner. */}
      <div className="flex items-center gap-3">
        <span className={`shrink-0 rounded-xl p-2.5 ${t.bg}`}>
          <Icon className={`h-[18px] w-[18px] ${t.fg}`} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-slate-500 dark:text-slate-400">
            {label}
          </span>
          <span className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">
              {typeof value === "number" ? value.toLocaleString() : value}
            </span>
            {trend && (
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
                  trend.value >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {trend.value >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {trend.value >= 0 ? "+" : ""}
                {trend.value} {trend.label}
              </span>
            )}
          </span>
        </span>
      </div>

      {hint && <p className="mt-2.5 text-xs text-slate-400">{hint}</p>}

      {to && (
        <span className="mt-3 inline-flex items-center gap-1 border-t border-slate-100 pt-2.5 text-xs font-medium text-[#2b6cf3] dark:border-white/[0.06]">
          {linkLabel ?? "View all"}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      )}
    </>
  );

  // Vertical padding trimmed (py-4 → py-3) so KPI rows take less height while
  // keeping the same horizontal padding, typography and layout.
  const classes = `group flex w-full flex-col px-4 py-3 text-left ${interactive ? CARD_INTERACTIVE : CARD} ${
    active ? "ring-2 ring-[#2b6cf3]" : ""
  } ${interactive ? FOCUS_RING : ""}`;

  if (to) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

/**
 * A department chip: coloured initials plus the name.
 *
 * Colour is derived from the name, so the same department looks the same
 * everywhere without anyone maintaining a mapping.
 */
export function DepartmentChip({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-xs text-slate-400">—</span>;
  const t = TONE[departmentTone(name)];
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold ${t.bg} ${t.fg}`}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <span className="truncate text-sm text-slate-700 dark:text-slate-200">{name}</span>
    </span>
  );
}

/** A person avatar + name, for tables that show who did something. */
export function UserChip({ name, email }: { name: string | null; email?: string | null }) {
  if (!name && !email) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ background: "linear-gradient(135deg,#2b4a82 0%,#15243D 100%)" }}
        aria-hidden="true"
      >
        {initials(name ?? email)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-slate-800 dark:text-slate-100">
          {name ?? "—"}
        </span>
        {email && <span className="block truncate text-[11px] text-slate-400">{email}</span>}
      </span>
    </span>
  );
}

/**
 * The list-page toolbar: one bar for search, filters and actions.
 *
 * Replaces filters scattered across a page. `onReset` only renders when there is
 * something to reset, so it never sits there disabled.
 */
export function Toolbar({
  children,
  onReset,
  actions,
}: {
  children: React.ReactNode;
  onReset?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`${CARD} flex flex-wrap items-center gap-2 p-2`}>
      {children}
      <div className="ml-auto flex items-center gap-2">
        {onReset && (
          <Button variant="ghost" size="sm" onClick={onReset} className="text-slate-500">
            Reset
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
