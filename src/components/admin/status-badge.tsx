import { Badge } from "@/components/ui/badge";

/**
 * One badge for every status in the system, so "active" looks identical on the
 * users table and the documents table.
 */
const STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  healthy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  draft: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  inactive: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  archived: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  suspended: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  offline: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  super_admin: "bg-[#15243D] text-white dark:bg-[#2b4a82]",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  team_leader: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
};

const LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  team_leader: "Team Leader",
};

export function StatusBadge({ value }: { value: string }) {
  const label = LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <Badge variant="secondary" className={`border-0 font-medium ${STYLES[value] ?? STYLES.draft}`}>
      {/* A dot as well as colour: status must not depend on hue alone. */}
      {(value === "processing" || value === "failed") && (
        <span
          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
            value === "processing" ? "animate-pulse bg-blue-500" : "bg-red-500"
          }`}
        />
      )}
      {label}
    </Badge>
  );
}
