import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CARD } from "./theme";
import { ErrorState, TableSkeleton } from "./states";

/**
 * The shared admin table: sorting, pagination, and the loading/empty/error
 * states in one place so every page presents data identically.
 *
 * Sorting and paging are controlled by the parent, because the server does both
 * — a table that sorted its own page would silently sort one page of many.
 */

export interface Column<T> {
  key: string;
  header: string;
  /** Only columns the API can order by are sortable. */
  sortable?: boolean;
  className?: string;
  /** Hidden below `sm` so mobile keeps only the columns that matter. */
  hideOnMobile?: boolean;
  render: (row: T) => React.ReactNode;
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
}: DataTableProps<T>) {
  if (error) {
    return (
      <div className={CARD}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function toggleSort(key: string) {
    if (!onSortChange) return;
    onSortChange(
      sort?.key === key
        ? { key, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      {/* Wide tables scroll inside their own container; the page never does. */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <TableSkeleton cols={columns.length} />
        ) : rows.length === 0 ? (
          (empty ?? <div className="py-16 text-center text-sm text-slate-500">No data</div>)
        ) : (
          <Table>
            {caption && <caption className="sr-only">{caption}</caption>}
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`${col.className ?? ""} ${col.hideOnMobile ? "hidden sm:table-cell" : ""}`}
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
                        className="inline-flex items-center gap-1 rounded font-medium transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:hover:text-white"
                      >
                        {col.header}
                        {sort?.key === col.key ? (
                          sort.direction === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={`${col.className ?? ""} ${col.hideOnMobile ? "hidden sm:table-cell" : ""}`}
                    >
                      {col.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {onPageChange && total > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row dark:border-white/10">
          <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
            Showing {from}–{to} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <span className="px-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
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
