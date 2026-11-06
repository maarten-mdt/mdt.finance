import "server-only";
import pg from "pg";
import { env } from "@/lib/env";

// Return bigint columns as strings; callers convert to BigInt. Never parse money as a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
// Keep `date` columns as YYYY-MM-DD strings instead of JS Dates in the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

const globalForDb = globalThis as unknown as { __mdtPool?: pg.Pool };

function pool(): pg.Pool {
  globalForDb.__mdtPool ??= new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
  return globalForDb.__mdtPool;
}

export interface DbContext {
  /** The signed-in person; null for unauthenticated work (invite acceptance). */
  personId: string | null;
  /** Recorded in audit_log. A person id, or e.g. "system:invite-acceptance". */
  actorId: string;
  /** Only set for admin actions; the database also checks user_roles. */
  isAdmin: boolean;
}

export type Tx = pg.PoolClient;

/**
 * Run `fn` in one transaction as `ctx`. Row-level security and the audit log read these
 * settings, so every query in the app goes through here.
 */
export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.person_id', $1, true),
              set_config('app.actor_id', $2, true),
              set_config('app.is_admin', $3, true)`,
      [ctx.personId ?? "", ctx.actorId, ctx.isAdmin ? "true" : "false"],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
