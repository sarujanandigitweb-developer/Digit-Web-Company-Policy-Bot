import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Shared date-range filter for the list pages.
 *
 * Controlled: the page owns `from`/`to` (the query bounds, YYYY-MM-DD) and this
 * derives which preset that pair represents, so the dropdown label stays honest
 * even after a reset. "Custom" reveals two date inputs; the presets fill the
 * bounds directly.
 */
export interface DateRange {
  from: string;
  to: string;
}

const PRESETS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
] as const;

/** Local YYYY-MM-DD, matching what a native date input emits. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeForPreset(preset: string): DateRange {
  const now = new Date();
  const today = ymd(now);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: ymd(y), to: ymd(y) };
    }
    case "7d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { from: ymd(start), to: today };
    }
    case "30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { from: ymd(start), to: today };
    }
    default:
      return { from: "", to: "" };
  }
}

/** Which preset the current bounds correspond to (so the label is correct). */
function presetForRange(value: DateRange): string {
  if (!value.from && !value.to) return "all";
  for (const p of ["today", "yesterday", "7d", "30d"]) {
    const r = rangeForPreset(p);
    if (r.from === value.from && r.to === value.to) return p;
  }
  return "custom";
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const preset = useMemo(() => presetForRange(value), [value]);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        value={preset}
        onValueChange={(p) => {
          if (p === "custom") {
            // Keep whatever bounds exist; the inputs below take over.
            if (!value.from && !value.to) onChange({ from: "", to: "" });
          } else {
            onChange(rangeForPreset(p));
          }
        }}
      >
        <SelectTrigger className="h-9 w-[150px]" aria-label="Date range">
          <CalendarDays className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="date-from" className="text-[11px] text-slate-400">
              From
            </Label>
            <Input
              id="date-from"
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="h-9 w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="date-to" className="text-[11px] text-slate-400">
              To
            </Label>
            <Input
              id="date-to"
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="h-9 w-[150px]"
            />
          </div>
        </>
      )}
    </div>
  );
}
