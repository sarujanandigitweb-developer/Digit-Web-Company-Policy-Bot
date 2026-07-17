import { neon, neonConfig, Pool } from "@neondatabase/serverless";

/**
 * Database access for serverless functions.
 *
 * `sql` uses Neon's HTTP driver: one request per query, no TCP pool to exhaust
 * when Vercel scales this function out. That is the whole reason the pooled
 * DATABASE_URL is used here and the unpooled one is reserved for migrations.
 *
 * HTTP cannot hold a transaction open across statements, so anything needing
 * one uses `withTransaction` below, which borrows a real connection.
 */

neonConfig.fetchConnectionCache = true;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/** Tagged-template query. Interpolations are parameterised, never concatenated. */
export const sql = neon(connectionString());

/**
 * Runs `fn` inside a single transaction on a dedicated connection.
 *
 * Use for multi-statement writes that must not half-apply — e.g. mutating a row
 * and writing its audit entry, which must either both land or neither.
 * The pool is created per call and closed in `finally`: a serverless instance
 * may be frozen right after the response, so a long-lived pool would leak.
 */
export async function withTransaction<T>(
  fn: (tx: import("@neondatabase/serverless").PoolClient) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: connectionString() });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}
