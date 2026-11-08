/**
 * Real-Postgres test harness. Creates a throwaway database, runs every migration, and gives
 * tests an owner connection (for fixtures) plus app_user connections with a request context,
 * exactly like the app.
 *
 * TEST_DATABASE_ADMIN_URL defaults to the local dev server on port 5433.
 */
import pg from "pg";
import { migrate } from "@/scripts/migrate";

pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres@localhost:5433/postgres";

function urlFor(db: string, user?: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = user; // local test roles use their name as password
  }
  return u.toString();
}

export interface TestDb {
  name: string;
  owner: pg.Client;
  /** Run `fn` as app_user inside a transaction with the given request context. */
  as<T>(ctx: { personId?: string | null; isAdmin?: boolean; actor?: string }, fn: (c: pg.Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `mdt_test_${process.pid}_${Date.now()}`;
  const root = new pg.Client({ connectionString: adminUrl });
  await root.connect();
  await root.query(`CREATE DATABASE ${name}`);
  await root.end();

  await migrate(urlFor(name), () => {});
  const owner = new pg.Client({ connectionString: urlFor(name) });
  await owner.connect();
  await owner.query("ALTER ROLE app_user WITH LOGIN PASSWORD 'app_user'");
  await owner.query("SELECT set_config('app.actor_id', 'system:test-fixture', false)");

  const appClient = new pg.Client({ connectionString: urlFor(name, "app_user") });
  await appClient.connect();

  return {
    name,
    owner,
    async as(ctx, fn) {
      await appClient.query("BEGIN");
      try {
        await appClient.query(
          `SELECT set_config('app.person_id', $1, true), set_config('app.actor_id', $2, true),
                  set_config('app.is_admin', $3, true)`,
          [ctx.personId ?? "", ctx.actor ?? ctx.personId ?? "test", ctx.isAdmin ? "true" : "false"],
        );
        const r = await fn(appClient);
        await appClient.query("COMMIT");
        return r;
      } catch (e) {
        await appClient.query("ROLLBACK");
        throw e;
      }
    },
    async close() {
      await appClient.end();
      await owner.end();
      const r = new pg.Client({ connectionString: adminUrl });
      await r.connect();
      await r.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await r.end();
    },
  };
}

/** Insert a person as the owner and return its id. */
export async function addPerson(
  db: TestDb,
  p: { name: string; type?: string; email?: string | null; hire?: string | null; key?: string | null },
): Promise<string> {
  const type = p.type ?? "employee";
  const r = await db.owner.query<{ id: string }>(
    `INSERT INTO people (type, name, email, hire_date, status, system_key)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      type,
      p.name,
      p.email === undefined ? (type === "employee" ? `${p.name.toLowerCase().replace(/\W+/g, ".")}@example.com` : null) : p.email,
      p.hire === undefined ? (type === "employee" ? "2020-01-01" : null) : p.hire,
      type === "employee" ? "active" : "not_applicable",
      p.key ?? null,
    ],
  );
  return r.rows[0]!.id;
}
