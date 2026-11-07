import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { migrate } from "../../scripts/migrate";
import { insertInvite } from "../../scripts/lib";

export const STATE_FILE = path.join(import.meta.dirname, ".state.json");

/** Fresh database → migrations → staging seed → an invite link for one seeded holder. */
export default async function globalSetup() {
  const owner = new URL(process.env.DATABASE_OWNER_URL!);
  const adminDb = new URL(owner);
  adminDb.pathname = "/postgres";
  const root = new pg.Client({ connectionString: adminDb.toString() });
  await root.connect();
  await root.query("DROP DATABASE IF EXISTS mdt_e2e WITH (FORCE)");
  await root.query("CREATE DATABASE mdt_e2e");
  await root.end();

  process.env.APP_DB_PASSWORD ??= "app_user";
  process.env.AUTH_DB_PASSWORD ??= "auth_service";
  await migrate(owner.toString(), () => {});
  execFileSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "inherit", env: process.env });

  const c = new pg.Client({ connectionString: owner.toString() });
  await c.connect();
  await c.query("SELECT set_config('app.actor_id', 'system:e2e', false)");
  const holder = (
    await c.query<{ id: string; email: string; shares: string }>(
      `SELECT p.id, p.email, h.shares::text FROM people p JOIN holdings h ON h.holder_id = p.id
       WHERE p.type = 'employee' AND h.shares > 0 ORDER BY p.email LIMIT 1`,
    )
  ).rows[0]!;
  const invite = await insertInvite(c, holder.id, process.env.BETTER_AUTH_URL!);

  const admin = (
    await c.query<{ id: string; email: string }>(
      "SELECT id, email FROM people WHERE type = 'employee' AND id <> $1 ORDER BY email DESC LIMIT 1",
      [holder.id],
    )
  ).rows[0]!;
  await c.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [admin.id]);
  const adminInvite = await insertInvite(c, admin.id, process.env.BETTER_AUTH_URL!);
  await c.end();
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ invite, email: holder.email, shares: holder.shares, adminInvite, adminEmail: admin.email }),
  );
}
