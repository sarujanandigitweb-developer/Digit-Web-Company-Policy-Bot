import { sql, withTransaction } from "@/lib/db/client.server";
import { write as writeAudit } from "@/lib/audit/log.server";
import { createAuthUser, originOf } from "@/lib/auth/neon-auth.server";
import { assignableRoles, type Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session.server";
import { BadRequest, Conflict, Forbidden, NotFound } from "@/lib/http/errors";
import type { CreateUserInput, UpdateUserInput } from "@/lib/validators/admin";
import { listUsersQuerySchema } from "@/lib/validators/admin";
import type { z } from "zod";

type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface AdminUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  department_id: string | null;
  department_name: string | null;
  status: "active" | "suspended";
  created_at: string;
  updated_at: string;
}

/**
 * Whether `actor` may act on a user holding `targetRole`.
 *
 * Admins manage staff only. Without this an admin could edit or suspend a peer
 * — or a super admin — which would make the role hierarchy decorative.
 */
function assertCanManage(actor: SessionUser, targetRole: Role): void {
  if (actor.role === "super_admin") return;
  if (actor.role === "admin" && targetRole === "staff") return;
  throw Forbidden(`Admins can only manage staff accounts`);
}

/** Guards against removing the last way into the system. */
async function assertNotLastSuperAdmin(
  tx: import("@neondatabase/serverless").PoolClient,
  userId: string,
): Promise<void> {
  const { rows } = await tx.query(
    `SELECT count(*)::int AS count FROM profiles
      WHERE role = 'super_admin' AND status = 'active' AND user_id <> $1::uuid`,
    [userId],
  );
  if (rows[0].count === 0) {
    throw Conflict(
      "This is the last active super admin. Promote another user first, " +
        "otherwise nobody could administer the system.",
    );
  }
}

/**
 * Sortable columns, mapped to fixed SQL. ORDER BY cannot be a bound parameter,
 * so the only safe form is a lookup whose values are literals in this file —
 * the request selects a key, never supplies a fragment.
 */
const USER_SORT_SQL: Record<string, string> = {
  name: "p.full_name",
  email: "u.email",
  role: "p.role",
  status: "p.status",
  created: "p.created_at",
};

export async function list(query: ListUsersQuery): Promise<{ items: AdminUser[]; total: number }> {
  const offset = (query.page - 1) * query.pageSize;
  const search = query.search ?? null;
  const orderColumn = USER_SORT_SQL[query.sortBy] ?? USER_SORT_SQL.created;
  const orderDir = query.sortDir === "asc" ? "ASC" : "DESC";

  // Email lives in neon_auth."user"; name and role live in profiles. Searching
  // both means joining, and the join is also what proves a profile exists.
  const rows = (await sql`
    SELECT p.user_id, u.email, p.full_name, p.role, p.department_id,
           d.name AS department_name, p.status, p.created_at, p.updated_at,
           count(*) OVER()::int AS total_count
    FROM profiles p
    JOIN neon_auth."user" u ON u.id = p.user_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE (${search}::text IS NULL
             OR p.full_name ILIKE '%' || ${search} || '%'
             OR u.email     ILIKE '%' || ${search} || '%')
      AND (${query.role ?? null}::user_role IS NULL OR p.role = ${query.role ?? null}::user_role)
      AND (${query.status ?? null}::user_status IS NULL
             OR p.status = ${query.status ?? null}::user_status)
      AND (${query.departmentId ?? null}::uuid IS NULL
             OR p.department_id = ${query.departmentId ?? null}::uuid)
    ORDER BY ${sql.unsafe(orderColumn)} ${sql.unsafe(orderDir)} NULLS LAST, p.user_id
    LIMIT ${query.pageSize} OFFSET ${offset}
  `) as Array<AdminUser & { total_count: number }>;

  const items = rows.map(({ total_count: _t, ...item }) => item);
  return { items, total: rows[0]?.total_count ?? 0 };
}

export async function getById(id: string): Promise<AdminUser> {
  const rows = (await sql`
    SELECT p.user_id, u.email, p.full_name, p.role, p.department_id,
           d.name AS department_name, p.status, p.created_at, p.updated_at
    FROM profiles p
    JOIN neon_auth."user" u ON u.id = p.user_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.user_id = ${id}::uuid
  `) as AdminUser[];
  const row = rows[0];
  if (!row) throw NotFound("User not found");
  return row;
}

/**
 * Creates an identity in Neon Auth and its matching profile.
 *
 * These live in two systems, so this cannot be one atomic transaction. The order
 * matters: create the identity first, then the profile inside a transaction, and
 * if that transaction fails delete the identity again. An identity without a
 * profile is inert — getSessionUser returns null for it, so the account cannot
 * sign in to anything — but leaving one behind would block the email address
 * from ever being reused, so it is cleaned up rather than tolerated.
 */
export async function create(
  input: CreateUserInput,
  actor: SessionUser,
  request: Request,
): Promise<AdminUser> {
  if (!assignableRoles(actor.role).includes(input.role)) {
    throw Forbidden(`You cannot create a user with the role "${input.role}"`);
  }

  // Rejected before the identity exists, so a bad department cannot orphan one.
  if (input.role === "staff" && !input.departmentId) {
    throw BadRequest("Staff must be assigned to a department");
  }
  if (input.departmentId) await assertDepartmentExists(input.departmentId);

  const authUser = await createAuthUser({
    email: input.email,
    password: input.password,
    fullName: input.fullName,
    origin: originOf(request),
  });

  try {
    await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO profiles (user_id, full_name, role, department_id, status)
         VALUES ($1::uuid, $2, $3::user_role, $4::uuid, 'active')
         RETURNING *`,
        [authUser.id, input.fullName, input.role, input.departmentId ?? null],
      );

      await writeAudit(tx, {
        actor,
        action: "user.created",
        table: "profiles",
        recordId: authUser.id,
        // The password is never echoed back, not even into the audit trail.
        newValue: { ...rows[0], email: input.email },
        request,
      });
    });

    // Read only after COMMIT: getById goes over the HTTP driver on a different
    // connection, which cannot see this transaction's uncommitted rows.
    return await getById(authUser.id);
  } catch (error) {
    // Compensating action: undo the identity so the address stays available.
    // CASCADE on neon_auth."user" clears any half-written profile with it.
    try {
      await sql`DELETE FROM neon_auth."user" WHERE id = ${authUser.id}::uuid`;
    } catch (cleanupError) {
      console.error(
        `[users.service] orphaned auth user ${authUser.id} (${input.email}): profile creation ` +
          `failed and cleanup also failed. Delete it manually.`,
        cleanupError,
      );
    }
    throw error;
  }
}

export async function update(
  id: string,
  input: UpdateUserInput,
  actor: SessionUser,
  request: Request,
): Promise<AdminUser> {
  if (input.departmentId) await assertDepartmentExists(input.departmentId);

  await withTransaction(async (tx) => {
    const before = await tx.query(`SELECT * FROM profiles WHERE user_id = $1::uuid FOR UPDATE`, [
      id,
    ]);
    if (!before.rowCount) throw NotFound("User not found");
    const current = before.rows[0] as { role: Role; status: string; department_id: string | null };

    assertCanManage(actor, current.role);

    if (input.role && input.role !== current.role) {
      // Changing roles is a super admin power even when the target is staff.
      if (actor.role !== "super_admin") throw Forbidden("Only a super admin can change roles");
      if (id === actor.userId) throw Forbidden("You cannot change your own role");
      if (current.role === "super_admin") await assertNotLastSuperAdmin(tx, id);
    }

    if (input.status && input.status !== current.status) {
      // Suspending yourself locks you out with no way back in.
      if (id === actor.userId) throw Forbidden("You cannot change your own status");
      if (input.status === "suspended" && current.role === "super_admin") {
        await assertNotLastSuperAdmin(tx, id);
      }
    }

    // The staff_require_department CHECK rejects staff without a department; catch
    // the combination here so the caller gets a reason instead of a constraint name.
    const nextRole = input.role ?? current.role;
    const nextDepartment =
      input.departmentId !== undefined ? input.departmentId : current.department_id;
    if (nextRole === "staff" && !nextDepartment) {
      throw BadRequest("Staff must be assigned to a department");
    }

    const { rows } = await tx.query(
      `UPDATE profiles SET
         full_name = COALESCE($2, full_name),
         role = COALESCE($3::user_role, role),
         department_id = CASE WHEN $4::bool THEN $5::uuid ELSE department_id END,
         status = COALESCE($6::user_status, status)
       WHERE user_id = $1::uuid
       RETURNING *`,
      [
        id,
        input.fullName ?? null,
        input.role ?? null,
        Object.prototype.hasOwnProperty.call(input, "departmentId"),
        input.departmentId ?? null,
        input.status ?? null,
      ],
    );

    // One PATCH can be several meaningful events; record the most specific one.
    const action =
      input.role && input.role !== current.role
        ? "user.role_changed"
        : input.status === "suspended" && current.status !== "suspended"
          ? "user.suspended"
          : input.status === "active" && current.status !== "active"
            ? "user.activated"
            : "user.updated";

    await writeAudit(tx, {
      actor,
      action,
      table: "profiles",
      recordId: id,
      oldValue: before.rows[0],
      newValue: rows[0],
      request,
    });
  });

  // After COMMIT, for the same reason as in create().
  return getById(id);
}

/**
 * Deletes a user.
 *
 * Removes the Neon Auth identity; profiles, sessions and accounts follow via
 * ON DELETE CASCADE. Chat history, uploads and audit entries reference the user
 * with ON DELETE SET NULL, so the record of what happened survives while the
 * person is removed.
 */
export async function remove(id: string, actor: SessionUser, request: Request): Promise<void> {
  if (id === actor.userId) throw Forbidden("You cannot delete your own account");

  await withTransaction(async (tx) => {
    const before = await tx.query(
      `SELECT p.*, u.email FROM profiles p
       JOIN neon_auth."user" u ON u.id = p.user_id
       WHERE p.user_id = $1::uuid FOR UPDATE OF p`,
      [id],
    );
    if (!before.rowCount) throw NotFound("User not found");
    const current = before.rows[0] as { role: Role };

    assertCanManage(actor, current.role);
    if (current.role === "super_admin") await assertNotLastSuperAdmin(tx, id);

    // Written before the delete: afterwards the row is gone and unreadable.
    await writeAudit(tx, {
      actor,
      action: "user.deleted",
      table: "profiles",
      recordId: id,
      oldValue: before.rows[0],
      request,
    });

    await tx.query(`DELETE FROM neon_auth."user" WHERE id = $1::uuid`, [id]);
  });
}

async function assertDepartmentExists(departmentId: string): Promise<void> {
  const rows = (await sql`
    SELECT status FROM departments WHERE id = ${departmentId}::uuid
  `) as Array<{ status: string }>;
  if (!rows[0]) throw BadRequest("Department not found");
  if (rows[0].status !== "active")
    throw BadRequest("Cannot assign users to an inactive department");
}
