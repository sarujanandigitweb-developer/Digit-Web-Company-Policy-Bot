import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { BRAND } from "@/components/admin/theme";

export const Route = createFileRoute("/admin/departments")({
  component: DepartmentsPage,
});

function DepartmentsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const departments = useQuery({
    queryKey: ["departments-page", page, debouncedSearch],
    queryFn: () =>
      api.get<Paged<Department>>(
        `/api/admin/departments${qs({ page, pageSize: 25, search: debouncedSearch || undefined })}`,
      ),
    placeholderData: (prev) => prev,
  });

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

  const columns = useMemo<Column<Department>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        render: (d) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800 dark:text-slate-100">{d.name}</p>
            <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
              {d.slug}
            </p>
          </div>
        ),
      },
      {
        key: "description",
        header: "Description",
        hideOnMobile: true,
        render: (d) => (
          <p className="line-clamp-1 max-w-sm text-xs text-slate-600 dark:text-slate-300">
            {d.description ?? "—"}
          </p>
        ),
      },
      { key: "status", header: "Status", render: (d) => <StatusBadge value={d.status} /> },
      {
        key: "documents",
        header: "Documents",
        hideOnMobile: true,
        render: (d) => (
          <span className="tabular-nums text-slate-600 dark:text-slate-300">
            {d.document_count}
          </span>
        ),
      },
      {
        key: "created",
        header: "Created",
        hideOnMobile: true,
        render: (d) => (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {new Date(d.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        className: "text-right",
        render: (d) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${d.name}`}
              onClick={() => setEditing(d)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${d.name}`}
              onClick={() => setDeleting(d)}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Departments
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Knowledge is scoped to a department.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          style={{ background: BRAND }}
          className="text-white"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New department
        </Button>
      </header>

      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder="Search departments…"
        aria-label="Search departments"
        className="w-full sm:max-w-xs"
      />

      <DataTable
        caption="Departments"
        columns={columns}
        rows={departments.data?.items ?? []}
        rowKey={(d) => d.id}
        isLoading={departments.isLoading}
        error={departments.error}
        onRetry={() => departments.refetch()}
        page={page}
        pageSize={departments.data?.pageSize ?? 25}
        total={departments.data?.total ?? 0}
        onPageChange={setPage}
        empty={
          debouncedSearch ? (
            <NoResults query={debouncedSearch} onClear={() => setSearch("")} />
          ) : (
            <EmptyState
              icon={Building2}
              title="No departments"
              description="Create one to organise knowledge."
            />
          )
        }
      />

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlug(department?.slug ?? "");
    setName(department?.name ?? "");
    setDescription(department?.description ?? "");
    setStatus(department?.status ?? "active");
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
          })
        : api.post<Department>("/api/admin/departments", {
            slug,
            name,
            description: description || undefined,
            status,
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
          <DialogTitle>{isEdit ? `Edit ${department!.name}` : "New department"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "The slug cannot change — code and stored references key off it."
              : "Creating a department is a super admin action."}
          </DialogDescription>
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
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                required
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
                placeholder="legal"
              />
              {fieldErrors.slug ? (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.slug}
                </p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Permanent identifier. Lowercase letters, digits, hyphen.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="dname">Name</Label>
            <Input
              id="dname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
            {fieldErrors.name && (
              <p className="text-xs text-red-600" role="alert">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ddesc">Description</Label>
            <Textarea
              id="ddesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dstatus">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
              <SelectTrigger id="dstatus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
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
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
