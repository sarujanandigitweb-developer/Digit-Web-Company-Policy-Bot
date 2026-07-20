import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  FileText,
  Globe,
  LayoutGrid,
  List,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError, qs, type Department, type Paged } from "@/lib/api/client";
import { useDebounced } from "@/hooks/use-debounced";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState, NoResults } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  BRAND,
  CARD,
  CARD_INTERACTIVE,
  FOCUS_RING,
  initials,
  TEXT_SUBTLE,
  TONE,
  departmentTone,
} from "@/components/admin/theme";
import { Kpi, PageHeader, Toolbar } from "@/components/admin/primitives";

export const Route = createFileRoute("/admin/departments")({
  component: DepartmentsPage,
});

const ALL = "__all__";
type ViewMode = "list" | "grid";

function DepartmentsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  // Status is applied client-side over the current page: the list API has no
  // status filter, and inventing a backend change for a view toggle is out of
  // scope. The label below says "on this page" so it never over-promises.
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [view, setView] = useState<ViewMode>("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const departments = useQuery({
    queryKey: ["departments-page", page, debouncedSearch],
    queryFn: () =>
      api.get<Paged<Department>>(
        `/api/admin/departments${qs({ page, pageSize: 24, search: debouncedSearch || undefined })}`,
      ),
    placeholderData: (prev) => prev,
  });

  const pageItems = departments.data?.items ?? [];
  const items =
    statusFilter === ALL ? pageItems : pageItems.filter((d) => d.status === statusFilter);

  const activeCount = pageItems.filter((d) => d.status === "active").length;
  const withDocs = pageItems.filter((d) => d.document_count > 0).length;
  const totalDocs = pageItems.reduce((sum, d) => sum + d.document_count, 0);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["departments-page"] });
    void qc.invalidateQueries({ queryKey: ["departments"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/admin/departments/${id}`),
    onSuccess: () => {
      toast.success("Department deleted");
      setDeleting(null);
      invalidate();
    },
    // The server explains exactly why (documents or users still attached);
    // repeating that rule here would let the two drift apart.
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });

  // Edit and Delete shown directly, matching the Users and Knowledge tables.
  const rowActions = (d: Department) => (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        aria-label={`Edit ${d.name}`}
        onClick={() => setEditing(d)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-slate-400 hover:text-red-600"
        aria-label={`Delete ${d.name}`}
        onClick={() => setDeleting(d)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );

  const columns = useMemo<Column<Department>[]>(
    () => [
      {
        key: "name",
        header: "Department",
        render: (d) => (
          <div className="flex min-w-0 items-center gap-3">
            <DepartmentAvatar name={d.name} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-medium text-slate-800 dark:text-slate-100">
                {d.name}
                {d.is_shared && <SharedTag />}
              </p>
              <p className="truncate font-mono text-xs text-slate-400">{d.slug}</p>
            </div>
          </div>
        ),
      },
      {
        key: "description",
        header: "Description",
        hideOnMobile: true,
        render: (d) => (
          <p className="line-clamp-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            {d.description ?? (
              <span className="text-slate-300 dark:text-slate-600">No description</span>
            )}
          </p>
        ),
      },
      { key: "status", header: "Status", render: (d) => <StatusBadge value={d.status} /> },
      {
        key: "documents",
        header: "Documents",
        hideOnMobile: true,
        render: (d) => <DocCount count={d.document_count} />,
      },
      {
        key: "created",
        header: "Created",
        hideOnMobile: true,
        render: (d) => (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {new Date(d.created_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        className: "w-20 text-right",
        render: rowActions,
      },
    ],
    // rowActions closes over stable setters only.

    [],
  );

  const filtered = statusFilter !== ALL;
  const emptyState = debouncedSearch ? (
    <NoResults query={debouncedSearch} onClear={() => setSearch("")} />
  ) : filtered ? (
    <EmptyState
      icon={Building2}
      title="None on this page"
      description="No departments here match that status. Clear the filter or turn the page."
    />
  ) : (
    <EmptyState
      icon={Building2}
      title="No departments yet"
      description="Create one to start organising knowledge and staff."
      action={
        <Button
          size="sm"
          style={{ background: BRAND }}
          className="text-white"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New department
        </Button>
      }
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <PageHeader
        title="Departments"
        description="Knowledge and staff are scoped to a department."
        actions={
          <Button
            size="sm"
            className="h-9 gap-2 text-white"
            style={{ background: BRAND }}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New department
          </Button>
        }
      />

      <section aria-label="Department summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Total departments"
          value={departments.data?.total ?? 0}
          icon={Building2}
          tone="brand"
        />
        <Kpi
          label="Active"
          value={activeCount}
          icon={Building2}
          tone="emerald"
          hint="Accepting uploads"
        />
        <Kpi
          label="With content"
          value={withDocs}
          icon={FileText}
          tone="blue"
          hint="Searchable by the bot"
        />
        <Kpi
          label="Documents"
          value={totalDocs}
          icon={FileText}
          tone="violet"
          hint="On this page"
        />
      </section>

      <Toolbar
        onReset={
          debouncedSearch || filtered
            ? () => {
                setSearch("");
                setStatusFilter(ALL);
                setPage(1);
              }
            : undefined
        }
        actions={<ViewToggle view={view} onChange={setView} />}
      >
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search departments…"
          aria-label="Search departments"
          className="h-9 w-full sm:max-w-[260px]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </Toolbar>

      {view === "grid" ? (
        <GridView
          items={items}
          isLoading={departments.isLoading}
          empty={emptyState}
          onEdit={setEditing}
          onDelete={setDeleting}
          actions={rowActions}
        />
      ) : (
        <DataTable
          caption="Departments"
          columns={columns}
          rows={items}
          rowKey={(d) => d.id}
          isLoading={departments.isLoading}
          error={departments.error}
          onRetry={() => departments.refetch()}
          page={page}
          pageSize={departments.data?.pageSize ?? 24}
          total={departments.data?.total ?? 0}
          onPageChange={setPage}
          exportName="departments"
          empty={emptyState}
        />
      )}

      <DepartmentDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={invalidate} />
      <DepartmentDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        department={editing ?? undefined}
        onSaved={invalidate}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {(deleting?.document_count ?? 0) > 0
                ? `This department still has ${deleting?.document_count} document(s). The server will refuse until they are moved or deleted — deactivate it instead to hide it from uploads.`
                : "This permanently removes the department. Deactivating keeps it out of new uploads while preserving history."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Marks a department whose knowledge is company-wide. */
function SharedTag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
      <Globe className="h-2.5 w-2.5" />
      Shared
    </span>
  );
}

/** Larger department avatar for table rows and grid cards. */
function DepartmentAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const t = TONE[departmentTone(name)];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl text-xs font-semibold ${t.bg} ${t.fg}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

function DocCount({ count }: { count: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium tabular-nums ${
        count > 0
          ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
          : "bg-slate-100 text-slate-400 dark:bg-white/[0.04] dark:text-slate-500"
      }`}
    >
      <FileText className="h-3 w-3" />
      {count}
    </span>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-white/10"
      role="group"
      aria-label="View mode"
    >
      {(
        [
          ["list", List, "List view"],
          ["grid", LayoutGrid, "Grid view"],
        ] as const
      ).map(([mode, Icon, label]) => (
        <button
          key={mode}
          type="button"
          aria-label={label}
          aria-pressed={view === mode}
          onClick={() => onChange(mode)}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition ${FOCUS_RING} ${
            view === mode
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function GridView({
  items,
  isLoading,
  empty,
  onEdit,
  onDelete,
  actions,
}: {
  items: Department[];
  isLoading: boolean;
  empty: React.ReactNode;
  onEdit: (d: Department) => void;
  onDelete: (d: Department) => void;
  actions: (d: Department) => React.ReactNode;
}) {
  void onEdit;
  void onDelete;
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${CARD} h-[132px] animate-pulse`} />
        ))}
      </div>
    );
  }
  if (items.length === 0) return <div className={CARD}>{empty}</div>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((d) => (
        <div key={d.id} className={`${CARD_INTERACTIVE} flex flex-col p-4`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <DepartmentAvatar name={d.name} size={40} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate font-semibold text-slate-800 dark:text-slate-100">
                  {d.name}
                  {d.is_shared && <SharedTag />}
                </p>
                <p className="truncate font-mono text-xs text-slate-400">{d.slug}</p>
              </div>
            </div>
            {actions(d)}
          </div>
          <p
            className={`mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500 dark:text-slate-400`}
          >
            {d.description ?? <span className={TEXT_SUBTLE}>No description</span>}
          </p>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-white/[0.06]">
            <StatusBadge value={d.status} />
            <DocCount count={d.document_count} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DepartmentDialog({
  open,
  onOpenChange,
  department,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  department?: Department;
  onSaved: () => void;
}) {
  const isEdit = !!department;
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [isShared, setIsShared] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlug(department?.slug ?? "");
    setName(department?.name ?? "");
    setDescription(department?.description ?? "");
    setStatus(department?.status ?? "active");
    setIsShared(department?.is_shared ?? false);
    setFieldErrors({});
    setFormError(null);
  }, [open, department]);

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<Department>(`/api/admin/departments/${department!.id}`, {
            name,
            description: description || null,
            status,
            isShared,
          })
        : api.post<Department>("/api/admin/departments", {
            slug,
            name,
            description: description || undefined,
            status,
            isShared,
          }),
    onSuccess: () => {
      toast.success(isEdit ? "Department updated" : "Department created");
      onOpenChange(false);
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isValidation && e.details) {
        setFieldErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
      } else {
        setFormError(e instanceof Error ? e.message : "Could not save");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {name ? (
              <DepartmentAvatar name={name} size={40} />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-white/[0.06]">
                <Building2 className="h-5 w-5 text-slate-400" />
              </span>
            )}
            <div>
              <DialogTitle>{isEdit ? department!.name : "New department"}</DialogTitle>
              <DialogDescription className="mt-0.5">
                {isEdit
                  ? "The slug is permanent — code and stored references key off it."
                  : "Creating a department is a super admin action."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFieldErrors({});
            setFormError(null);
            mutation.mutate();
          }}
        >
          {!isEdit && (
            <Field
              label="Slug"
              htmlFor="slug"
              error={fieldErrors.slug}
              hint="Permanent identifier. Lowercase letters, digits, hyphen."
            >
              <Input
                id="slug"
                value={slug}
                required
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
                placeholder="legal"
                className="font-mono"
              />
            </Field>
          )}
          <Field label="Name" htmlFor="dname" error={fieldErrors.name}>
            <Input
              id="dname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="Legal & Compliance"
            />
          </Field>
          <Field label="Description" htmlFor="ddesc">
            <Textarea
              id="ddesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What this department covers…"
            />
          </Field>
          <Field label="Status" htmlFor="dstatus">
            <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
              <SelectTrigger id="dstatus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* Shared toggle. When on, this department's knowledge answers from
              every department's search, so the copy states that plainly. */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3 dark:border-white/10">
            <div className="min-w-0">
              <Label htmlFor="dshared" className="cursor-pointer">
                Shared knowledge
              </Label>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Documents in a shared department are searchable from every department, and the
                department is hidden from the chat picker.
              </p>
            </div>
            <Switch
              id="dshared"
              checked={isShared}
              onCheckedChange={setIsShared}
              className="mt-0.5"
            />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
            >
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending}
              style={{ background: BRAND }}
              className="text-white"
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create department"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}
