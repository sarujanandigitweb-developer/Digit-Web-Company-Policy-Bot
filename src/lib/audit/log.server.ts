import type { PoolClient } from "@neondatabase/serverless";
import type { SessionUser } from "@/lib/auth/session.server";

/**
 * Audit logging.
 *
 * `write` takes the transaction client rather than opening its own connection:
 * the log entry and the change it describes commit together, so an audit trail
 * can never claim something that rolled back — nor silently miss something that
 * committed.
 *
 * Services call `auditedUpdate`/`write` instead of hand-writing INSERTs, which is
 * what keeps logging out of the route handlers.
 */

export type AuditAction =
  | "user.created"
  | "user.updated"
  | "user.role_changed"
  | "user.suspended"
  | "user.activated"
  | "user.deleted"
  | "department.created"
  | "department.updated"
  | "department.deleted"
  | "knowledge.uploaded"
  | "knowledge.updated"
  | "knowledge.replaced"
  | "knowledge.activated"
  | "knowledge.deactivated"
  | "knowledge.archived"
  | "knowledge.deleted"
  | "gap.reviewed"
  | "gap.resolved"
  | "gap.updated"
  | "gap.deleted"
  | "conversation.deleted";

export interface AuditEntry {
  actor: Pick<SessionUser, "userId">;
  action: AuditAction;
  table: string;
  recordId: string;
  oldValue?: unknown;
  newValue?: unknown;
  request?: Request;
}

/** Client IP as seen behind Vercel's proxy; the socket address is the proxy's. */
function clientIp(request?: Request): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

export async function write(tx: PoolClient, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs
       (actor_id, action, table_name, record_id, old_value, new_value, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actor.userId,
      entry.action,
      entry.table,
      entry.recordId,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      clientIp(entry.request),
      entry.request?.headers.get("user-agent") ?? null,
    ],
  );
}

/**
 * Reads a row, applies `mutate`, and records before/after in one transaction.
 *
 * Capturing `oldValue` inside the transaction is the point: read it beforehand
 * and a concurrent write makes the audit trail describe a state that never
 * preceded this change.
 */
export async function auditedUpdate<T>(
  tx: PoolClient,
  options: {
    table: string;
    recordId: string;
    action: AuditAction;
    actor: Pick<SessionUser, "userId">;
    request?: Request;
    mutate: () => Promise<T>;
  },
): Promise<T> {
  const before = await snapshot(tx, options.table, options.recordId);
  const result = await options.mutate();
  const after = await snapshot(tx, options.table, options.recordId);

  await write(tx, {
    actor: options.actor,
    action: options.action,
    table: options.table,
    recordId: options.recordId,
    oldValue: before,
    newValue: after,
    request: options.request,
  });

  return result;
}

/**
 * Whole-row snapshot as jsonb.
 *
 * `table` is interpolated because identifiers cannot be bound as parameters. It
 * is never caller-supplied — services pass a literal — but the allowlist below
 * makes that guarantee structural rather than a convention someone can break.
 */
const AUDITABLE_TABLES = new Set([
  "profiles",
  "departments",
  "knowledge_documents",
  "knowledge_gaps",
]);

async function snapshot(tx: PoolClient, table: string, recordId: string): Promise<unknown | null> {
  if (!AUDITABLE_TABLES.has(table)) {
    throw new Error(`Refusing to audit unknown table: ${table}`);
  }
  const idColumn = table === "profiles" ? "user_id" : "id";
  const { rows } = await tx.query(
    `SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${idColumn} = $1::uuid`,
    [recordId],
  );
  return rows[0]?.row ?? null;
}
