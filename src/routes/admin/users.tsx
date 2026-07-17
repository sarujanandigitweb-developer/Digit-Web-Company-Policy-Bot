import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  UserPen,
  Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { api, ApiError, qs, type AdminUser, type Department, type Paged } from "@/lib/api/client";
import { DataTable, type Column, type SortState } from "@/components/admin/data-table";
import { useDebounced } from "@/hooks/use-debounced";
import { EmptyState, NoResults } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { BRAND } from "@/components/admin/theme";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

const ALL = "__all__"; // Radix Select forbids an empty-string value.

function UsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "created", direction: "desc" });
  const debouncedSearch = useDebounced(search);

  const filters = { search: debouncedSearch, role, status, departmentId, sort };

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Paged<Department>>("/api/admin/departments?pageSize=100"),
  });

  const users = useQuery({
    queryKey: ["users", page, filters],
    queryFn: () =>
      api.get<Paged<AdminUser>>(
        `/api/admin/users${qs({
          page,
          pageSize: 25,
          search: debouncedSearch || undefined,
          sortBy: sort.key,
          sortDir: sort.direction,
          role: role === ALL ? undefined : role,
          status: status === ALL ? undefined : status,
          departmentId: departmentId === ALL ? undefined : departmentId,
        })}`,
      ),
    placeholderData: (prev) => prev, // keeps the table steady while paging
  });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: "active" | "suspended" }) =>
      api.patch<AdminUser>(`/api/admin/users/${id}`, { status: next }),
    onSuccess: (_data, vars) => {
      toast.success(vars.next === "suspended" ? "User suspended" : "User activated");
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    // The server's message is the exact reason (e.g. last super admin) — showing
    // our own wording here would hide why it was refused.
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update user"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/admin/users/${id}`),
    onSuccess: () => {
      toast.success("User deleted");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete user"),
  });

  const columns = useMemo<Column<AdminUser>[]>(
    () => [
      {
        key: "name",
        sortable: true,
        header: "Name",
        render: (u) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800 dark:text-slate-100">
              {u.full_name ?? "—"}
            </p>
            <p className="truncate text-xs text-slate-500 sm:hidden dark:text-slate-400">
              {u.email}
            </p>
          </div>
        ),
      },
      {
        key: "email",
        sortable: true,
        header: "Email",
        hideOnMobile: true,
        render: (u) => <span className="text-slate-600 dark:text-slate-300">{u.email}</span>,
      },
      { key: "role", header: "Role", render: (u) => <StatusBadge value={u.role} /> },
      {
        key: "department",
        header: "Department",
        hideOnMobile: true,
        render: (u) => (
          <span className="text-slate-600 dark:text-slate-300">{u.department_name ?? "—"}</span>
        ),
      },
      { key: "status", header: "Status", render: (u) => <StatusBadge value={u.status} /> },
      {
        key: "created",
        sortable: true,
        header: "Created",
        hideOnMobile: true,
        render: (u) => (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {new Date(u.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        className: "text-right",
        render: (u) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${u.full_name}`}
              onClick={() => setEditing(u)}
            >
              <UserPen className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                u.status === "active" ? `Suspend ${u.full_name}` : `Activate ${u.full_name}`
              }
              disabled={setStatusMutation.isPending}
              onClick={() =>
                setStatusMutation.mutate({
                  id: u.user_id,
                  next: u.status === "active" ? "suspended" : "active",
                })
              }
            >
              {u.status === "active" ? (
                <Ban className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${u.full_name}`}
              onClick={() => setDeleting(u)}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        ),
      },
    ],
    [setStatusMutation],
  );

  function clearFilters() {
    setSearch("");
    setRole(ALL);
    setStatus(ALL);
    setDepartmentId(ALL);
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Users
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage accounts, roles and access.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          style={{ background: BRAND }}
          className="text-white"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New user
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search name or email…"
          aria-label="Search users"
          className="w-full sm:max-w-xs"
        />
        <FilterSelect
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          label="Role"
          options={[
            ["super_admin", "Super Admin"],
            ["admin", "Admin"],
            ["staff", "Staff"],
          ]}
        />
        <FilterSelect
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          label="Status"
          options={[
            ["active", "Active"],
            ["suspended", "Suspended"],
          ]}
        />
        <FilterSelect
          value={departmentId}
          onChange={(v) => {
            setDepartmentId(v);
            setPage(1);
          }}
          label="Department"
          options={(departments.data?.items ?? []).map((d) => [d.id, d.name])}
        />
      </div>

      <DataTable
        caption="Users"
        columns={columns}
        rows={users.data?.items ?? []}
        rowKey={(u) => u.user_id}
        isLoading={users.isLoading}
        error={users.error}
        onRetry={() => users.refetch()}
        page={page}
        pageSize={users.data?.pageSize ?? 25}
        total={users.data?.total ?? 0}
        onPageChange={setPage}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        empty={
          search || role !== ALL || status !== ALL || departmentId !== ALL ? (
            <NoResults query={search || "these filters"} onClear={clearFilters} />
          ) : (
            <EmptyState
              icon={UsersIcon}
              title="No users yet"
              description="Create the first account to get started."
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  New user
                </Button>
              }
            />
          )
        }
      />

      <UserFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        departments={departments.data?.items ?? []}
        onSaved={() => void qc.invalidateQueries({ queryKey: ["users"] })}
      />
      <UserFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        user={editing ?? undefined}
        departments={departments.data?.items ?? []}
        onSaved={() => void qc.invalidateQueries({ queryKey: ["users"] })}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes their login access permanently. Their chat history, uploads and audit
              trail stay, but are no longer linked to a person. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.user_id);
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: Array<[string, string]>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[150px]" aria-label={`Filter by ${label.toLowerCase()}`}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}s</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Create and edit share one dialog: the fields overlap almost entirely. */
function UserFormDialog({
  open,
  onOpenChange,
  user,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: AdminUser;
  departments: Department[];
  onSaved: () => void;
}) {
  const isEdit = !!user;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("staff");
  const [departmentId, setDepartmentId] = useState<string>(ALL);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Reset when the dialog opens, so a previous edit never leaks into the next.
  useEffect(() => {
    if (!open) return;
    setFullName(user?.full_name ?? "");
    setEmail(user?.email ?? "");
    setPassword("");
    setRole(user?.role ?? "staff");
    setDepartmentId(user?.department_id ?? ALL);
    setFieldErrors({});
    setFormError(null);
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        fullName,
        role,
        departmentId: departmentId === ALL ? null : departmentId,
        ...(isEdit ? {} : { email, password }),
      };
      return isEdit
        ? api.patch<AdminUser>(`/api/admin/users/${user!.user_id}`, body)
        : api.post<AdminUser>("/api/admin/users", body);
    },
    onSuccess: () => {
      toast.success(isEdit ? "User updated" : "User created");
      onOpenChange(false);
      onSaved();
    },
    onError: (e) => {
      // Server validation is authoritative — map its issues onto the fields
      // rather than re-implementing the same rules in the browser.
      if (e instanceof ApiError && e.isValidation && e.details) {
        setFieldErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
        setFormError(null);
      } else {
        setFormError(e instanceof Error ? e.message : "Could not save");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${user!.full_name}` : "New user"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this account. Role changes require super admin."
              : "Creates the login and the profile together."}
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
          <Field label="Full name" htmlFor="fullName" error={fieldErrors.fullName}>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </Field>

          {!isEdit && (
            <>
              <Field label="Email" htmlFor="email" error={fieldErrors.email}>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label="Password" htmlFor="password" error={fieldErrors.password}>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </Field>
            </>
          )}

          <Field label="Role" htmlFor="role" error={fieldErrors.role}>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Department"
            htmlFor="department"
            error={fieldErrors.departmentId}
            hint={
              role === "staff"
                ? "Required for staff accounts."
                : "Admins are not scoped to a department."
            }
          >
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger id="department">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>None</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {isEdit && (
            <Field label="Status" htmlFor="status">
              <Select
                value={user!.status}
                onValueChange={(v) =>
                  api
                    .patch(`/api/admin/users/${user!.user_id}`, { status: v })
                    .then(() => {
                      toast.success("Status updated");
                      onSaved();
                    })
                    .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"))
                }
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

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
              {isEdit ? "Save changes" : "Create user"}
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
