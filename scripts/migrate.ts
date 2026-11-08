/**
 * Applies db/migrations/*.sql in order, each in its own transaction, recording what ran in
 * schema_migrations. Then sets login passwords for the app_user and auth_service roles.
 *
 * Env:
 *   DATABASE_OWNER_URL  owner/superuser connection (on Railway: the Postgres service's DATABASE_URL)
 *   APP_DB_PASSWORD     password to set for app_user (optional locally)
 *   AUTH_DB_PASSWORD    password to set for auth_service (optional locally)
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const dir = path.join(import.meta.dirname, "..", "db", "migrations");

export async function migrate(ownerUrl: string, log: (m: string) => void = console.log): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    // One migrator at a time, even if two deploys start together.
    await client.query("SELECT pg_advisory_lock(727274)");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.actor_id', 'system:migration', true)");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log(`applied ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
    for (const [role, envName] of [["app_user", "APP_DB_PASSWORD"], ["auth_service", "AUTH_DB_PASSWORD"]] as const) {
      const pw = process.env[envName];
      if (pw) {
        const quoted = (await client.query<{ q: string }>("SELECT quote_literal($1) AS q", [pw])).rows[0]!.q;
        await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${quoted}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error("DATABASE_OWNER_URL is required");
    process.exit(1);
  }
  migrate(url).then(
    () => console.log("migrations up to date"),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
