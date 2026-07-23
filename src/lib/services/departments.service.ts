import { sql, withTransaction } from "@/lib/db/client.server";
import { write as writeAudit } from "@/lib/audit/log.server";
import { Conflict, NotFound } from "@/lib/http/errors";
import type { SessionUser } from "@/lib/auth/session.server";
import type {
  CreateDepartmentInput,
  ListQuery,
  UpdateDepartmentInput,
} from "@/lib/validators/admin";

export interface Department {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  /** When true, this department's knowledge is searchable from every department. */
  is_shared: boolean;
  document_count: number;
  created_at: string;
  updated_at: string;
}

/** Departments with a live document count, so the UI can warn before deleting. */
export async function list(query: ListQuery): Promise<{ items: Department[]; total: number }> {
  const offset = (query.page - 1) * query.pageSize;
  const search = query.search ?? null;

  const rows = (await sql`
    SELECT d.*,
           (SELECT count(*) FROM knowledge_documents kd
             WHERE kd.department_id = d.id AND kd.status <> 'archived')::int AS document_count,
           count(*) OVER()::int AS total_count
    FROM departments d
    WHERE ${search}::text IS NULL
       OR d.name ILIKE '%' || ${search} || '%'
       OR d.slug ILIKE '%' || ${search} || '%'
    ORDER BY d.name
    LIMIT ${query.pageSize} OFFSET ${offset}
  `) as Array<Department & { total_count: number }>;

  // total_count rides along on every row from the window function; strip it so
  // it is reported once rather than repeated inside each item.
  const items = rows.map(({ total_count: _total, ...item }) => item);
  return { items, total: rows[0]?.total_count ?? 0 };
}

export async function getById(id: string): Promise<Department> {
  const rows = (await sql`
    SELECT d.*,
           (SELECT count(*) FROM knowledge_documents kd
             WHERE kd.department_id = d.id AND kd.status <> 'archived')::int AS document_count
    FROM departments d WHERE d.id = ${id}::uuid
  `) as Department[];
  const row = rows[0];
  if (!row) throw NotFound("Department not found");
  return row;
}

export async function create(
  input: CreateDepartmentInput,
  actor: SessionUser,
  request: Request,
): Promise<Department> {
  return withTransaction(async (tx) => {
    const existing = await tx.query(`SELECT 1 FROM departments WHERE slug = $1`, [input.slug]);
    if (existing.rowCount) throw Conflict(`A department with slug "${input.slug}" already exists`);

    const { rows } = await tx.query(
      `INSERT INTO departments (slug, name, description, status, is_shared)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.slug, input.name, input.description ?? null, input.status, input.isShared ?? false],
    );
    const created = rows[0] as Department;

    await writeAudit(tx, {
      actor,
      action: "department.created",
      table: "departments",
      recordId: created.id,
      newValue: created,
      request,
    });

    return { ...created, document_count: 0 };
  });
}

export async function update(
  id: string,
  input: UpdateDepartmentInput,
  actor: SessionUser,
  request: Request,
): Promise<Department> {
  return withTransaction(async (tx) => {
    // Locked for the transaction so the audit "before" cannot be overwritten by
    // a concurrent edit between the read and the update.
    const before = await tx.query(`SELECT * FROM departments WHERE id = $1::uuid FOR UPDATE`, [id]);
    if (!before.rowCount) throw NotFound("Department not found");

    // COALESCE keeps this one statement for any subset of fields. `description`
    // is nullable-clearable, so it is passed through a sentinel-free explicit flag.
    const { rows } = await tx.query(
      `UPDATE departments SET
         name = COALESCE($2, name),
         description = CASE WHEN $3::bool THEN $4 ELSE description END,
         status = COALESCE($5, status),
         is_shared = COALESCE($6, is_shared)
       WHERE id = $1::uuid
       RETURNING *`,
      [
        id,
        input.name ?? null,
        Object.prototype.hasOwnProperty.call(input, "description"),
        input.description ?? null,
        input.status ?? null,
        input.isShared ?? null,
      ],
    );
    const after = rows[0] as Department;

    await writeAudit(tx, {
      actor,
      action: "department.updated",
      table: "departments",
      recordId: id,
      oldValue: before.rows[0],
      newValue: after,
      request,
    });

    return after;
  });
}

/**
 * Deletes a department, refusing when knowledge documents still reference it.
 *
 * The FK is ON DELETE RESTRICT, so the database would reject this anyway; the
 * explicit check exists to return a 409 that names the problem instead of
 * surfacing a raw constraint violation as a 500.
 */
export async function remove(id: string, actor: SessionUser, request: Request): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.query(`SELECT * FROM departments WHERE id = $1::uuid FOR UPDATE`, [id]);
    if (!before.rowCount) throw NotFound("Department not found");

    const docs = await tx.query(
      `SELECT count(*)::int AS count FROM knowledge_documents WHERE department_id = $1::uuid`,
      [id],
    );
    const count = docs.rows[0].count as number;
    if (count > 0) {
      throw Conflict(
        `Cannot delete: ${count} knowledge document(s) belong to this department. ` +
          `Move or delete them first, or deactivate the department instead.`,
        { documentCount: count },
      );
    }

    const assigned = await tx.query(
      `SELECT count(*)::int AS count FROM profiles WHERE department_id = $1::uuid`,
      [id],
    );
    if ((assigned.rows[0].count as number) > 0) {
      // profiles.department_id is ON DELETE SET NULL, which would silently strip
      // team leaders of their department and violate team_leader_require_department.
      throw Conflict(
        `Cannot delete: ${assigned.rows[0].count} user(s) are assigned to this department.`,
        { userCount: assigned.rows[0].count },
      );
    }

    await tx.query(`DELETE FROM departments WHERE id = $1::uuid`, [id]);

    await writeAudit(tx, {
      actor,
      action: "department.deleted",
      table: "departments",
      recordId: id,
      oldValue: before.rows[0],
      request,
    });
  });
}
