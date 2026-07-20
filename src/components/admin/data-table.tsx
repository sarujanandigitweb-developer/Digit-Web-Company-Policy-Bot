import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Download, Rows2, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CARD, FOCUS_RING } from "./theme";
import { ErrorState, TableSkeleton } from "./states";

/**
 * The shared admin table.
 *
 * Sorting and paging are controlled by the parent because the server does both —
 * a table that sorted its own page would silently sort one page of many.
 *
 * Density, column visibility and CSV export are local: they are presentation
 * only and no other page needs to know about them.
 */

export interface Column<T> {
  key: string;
  header: string;
  /** Only columns the API can order by should be sortable. */
  sortable?: boolean;
  className?: string;
  /** Hidden below `sm` so mobile keeps only the columns that matter. */
  hideOnMobile?: boolean;
  /** Excluded from the column picker — e.g. the actions column. */
  alwaysVisible?: boolean;
  render: (row: T) => React.ReactNode;
  /** Plain value for CSV. Falls back to omitting the column when absent. */
  exportValue?: (row: T) => string | number | null;
}

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  caption?: string;
  /** Makes rows clickable. Keyboard-accessible via the row's own link/button. */
  onRowClick?: (row: T) => void;
  /** Filename stem for CSV export. Omit to hide the export button. */
  exportName?: string;
  /** Opt-in row selection. Pages that omit these are unaffected. */
  selectable?: boolean;
  selected?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  /** Rendered above the header while rows are selected. */
  bulkActions?: (selected: Set<string>) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  empty,
  sort,
  onSortChange,
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  caption,
  onRowClick,
  exportName,
  selectable,
  selected,
  onSelectionChange,
  bulkActions,
}: DataTableProps<T>) {
  const [dense, setDense] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (error) {
    return (
      <div className={CARD}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  const visible = columns.filter((c) => !hidden.has(c.key));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const cellPad = dense ? "py-1.5" : "py-3";

  function toggleSort(key: string) {
    if (!onSortChange) return;
    onSortChange(
      sort?.key === key
        ? { key, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }

  /**
   * Exports the rows currently on screen — not the whole result set.
   * The label says "this page" so nobody mistakes a 25-row file for the lot.
   */
  function exportCsv() {
    const cols = visible.filter((c) => c.exportValue);
    const header = cols.map((c) => c.header);
    const body = rows.map((row) =>
      cols.map((c) => {
        const value = c.exportValue!(row);
        const text = value === null || value === undefined ? "" : String(value);
        // Quote always: content may contain commas, quotes or newlines.
        return `"${text.replace(/"/g, '""')}"`;
      }),
    );
    const csv = [header, ...body].map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const canExport = exportName && columns.some((c) => c.exportValue);

  const selectedCount = selected?.size ?? 0;
  const pageKeys = rows.map(rowKey);
  const allOnPageSelected = pageKeys.length > 0 && pageKeys.every((k) => selected?.has(k));

  function toggleAll() {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    // Only this page's keys are touched — a selection made on page 1 survives
    // paging to page 2 and back.
    if (allOnPageSelected) pageKeys.forEach((k) => next.delete(k));
    else pageKeys.forEach((k) => next.add(k));
    onSelectionChange(next);
  }

  function toggleRow(key: string) {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      {selectable && selectedCount > 0 && (
        <div className="flex items-center gap-3 border-b border-[#2b6cf3]/20 bg-[#2b6cf3]/[0.06] px-4 py-2">
          <span className="text-xs font-medium tabular-nums text-[#2b6cf3]">
            {selectedCount} selected
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {bulkActions?.(selected!)}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-slate-500"
              onClick={() => onSelectionChange?.(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
      {(canExport || columns.some((c) => !c.alwaysVisible)) && (
        <div className="flex items-center justify-end gap-1 border-b border-slate-100 px-2 py-1.5 dark:border-white/[0.06]">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDense((d) => !d)}
            className="h-8 text-xs text-slate-500"
            aria-pressed={dense}
          >
            {dense ? (
              <Rows3 className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Rows2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            {dense ? "Comfortable" : "Compact"}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500">
                <Columns3 className="mr-1.5 h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
              {columns
                .filter((c) => !c.alwaysVisible && c.header)
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={!hidden.has(c.key)}
                    onCheckedChange={(on) =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(c.key);
                        else next.add(c.key);
                        return next;
                      })
                    }
                  >
                    {c.header}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {canExport && (
            <Button
              variant="ghost"
              size="sm"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="h-8 text-xs text-slate-500"
              title="Exports the rows on this page"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
          )}
        </div>
      )}

      {/* Wide tables scroll inside their own container; the page never does. */}
      <div className="max-h-[calc(100vh-320px)] overflow-auto">
        {isLoading ? (
          <TableSkeleton cols={visible.length} />
        ) : rows.length === 0 ? (
          (empty ?? <div className="py-16 text-center text-sm text-slate-500">No data</div>)
        ) : (
          <table className="w-full border-collapse text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            {/* Sticky so the header survives a long scroll. */}
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
              <tr>
                {selectable && (
                  <th
                    scope="col"
                    className="w-10 border-b border-slate-200 px-3 py-2.5 dark:border-white/[0.08]"
                  >
                    <Checkbox
                      checked={allOnPageSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all rows on this page"
                    />
                  </th>
                )}
                {visible.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={`border-b border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-white/[0.08] dark:text-slate-400 ${col.className ?? ""} ${col.hideOnMobile ? "hidden sm:table-cell" : ""}`}
                    aria-sort={
                      sort?.key === col.key
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : col.sortable
                          ? "none"
                          : undefined
                    }
                  >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={`inline-flex items-center gap-1 rounded transition hover:text-slate-900 dark:hover:text-white ${FOCUS_RING}`}
                      >
                        {col.header}
                        {sort?.key === col.key ? (
                          sort.direction === "asc" ? (
                            <ArrowUp className="h-3 w-3 text-[#2b6cf3]" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-[#2b6cf3]" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-30" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-slate-100 transition-colors last:border-0 hover:bg-[#2b6cf3]/[0.04] dark:border-white/[0.04] dark:hover:bg-white/[0.04] ${
                    selected?.has(rowKey(row))
                      ? "bg-[#2b6cf3]/[0.05] dark:bg-[#2b6cf3]/[0.08]"
                      : "odd:bg-white even:bg-slate-50/40 dark:odd:bg-transparent dark:even:bg-white/[0.02]"
                  } ${onRowClick ? "cursor-pointer" : ""}`}
                >
                  {selectable && (
                    <td className="w-10 px-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected?.has(rowKey(row)) ?? false}
                        onCheckedChange={() => toggleRow(rowKey(row))}
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {visible.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 ${cellPad} align-middle ${col.className ?? ""} ${col.hideOnMobile ? "hidden sm:table-cell" : ""}`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {onPageChange && total > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 sm:flex-row dark:border-white/[0.06]">
          <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {from}–{to}
            </span>{" "}
            of <span className="font-medium text-slate-700 dark:text-slate-200">{total}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page <= 1 || isLoading}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <span className="px-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page >= totalPages || isLoading}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
