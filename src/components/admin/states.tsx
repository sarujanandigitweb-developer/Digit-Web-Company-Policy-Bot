import { AlertTriangle, Inbox, Loader2, Lock, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { BRAND } from "./theme";

/**
 * The loading / empty / error states every admin page shares.
 *
 * Centralised so a permission failure or an empty table looks the same wherever
 * it happens, and so pages don't each invent their own wording.
 */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400">
      <Spinner />
      <span role="status">{label}</span>
    </div>
  );
}

/** Table placeholder that keeps the page from collapsing while data loads. */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-2xl" />
      ))}
    </>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="rounded-2xl bg-slate-100 p-3 dark:bg-white/5">
        <Icon className="h-6 w-6" style={{ color: BRAND }} />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function NoResults({ query, onClear }: { query: string; onClear?: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`No results for “${query}”`}
      description="Try a different search term or clear the filters."
      action={
        onClear && (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        )
      }
    />
  );
}

/**
 * Renders any thrown error. A 401/403 gets its own treatment because "you can't
 * do this" and "something broke" are different problems for the reader.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const isPermission = error instanceof ApiError && error.isPermissionDenied;
  const message =
    error instanceof Error ? error.message : "Something went wrong. Please try again.";

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div
        className={`rounded-2xl p-3 ${isPermission ? "bg-amber-100 dark:bg-amber-900/30" : "bg-red-100 dark:bg-red-900/30"}`}
      >
        {isPermission ? (
          <Lock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        ) : (
          <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {isPermission ? "Permission denied" : "Couldn’t load this"}
        </p>
        <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">{message}</p>
      </div>
      {onRetry && !isPermission && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
