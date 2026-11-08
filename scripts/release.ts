/**
 * Railway pre-deploy step. Runs inside Railway's private network before each deploy:
 *   1. Apply migrations (always).
 *   2. If BOOTSTRAP_ADMIN_EMAIL is set and that admin has no login yet and no unused invite:
 *      create them as an admin and print a one-time invite link to the deploy log.
 *   3. If SEED_ON_DEPLOY=true and APP_ENV is not production: seed fake data once, and add any
 *      missing seed history to an existing seed.
 *
 * Env: DATABASE_OWNER_URL, APP_DB_PASSWORD, AUTH_DB_PASSWORD, BETTER_AUTH_URL, APP_ENV,
 *      SEED_ON_DEPLOY, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_HIRE_DATE
 */
import { execFileSync } from "node:child_process";
import { migrate } from "./migrate";
import { insertInvite, ownerClient } from "./lib";

async function main() {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is required");
  if (!process.env.APP_DB_PASSWORD || !process.env.AUTH_DB_PASSWORD) {
    throw new Error("APP_DB_PASSWORD and AUTH_DB_PASSWORD are required");
  }
  await migrate(ownerUrl);

  const isProd = process.env.APP_ENV === "production";
  const c = await ownerClient("system:release");
  try {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    if (email) {
      const r = await c.query<{ id: string | null; has_login: boolean; open_invite: boolean }>(
        `SELECT p.id,
                EXISTS (SELECT 1 FROM "user" u WHERE u."personId" = p.id) AS has_login,
                EXISTS (SELECT 1 FROM invites i WHERE i.person_id = p.id AND i.used_at IS NULL AND i.expires_at > now()) AS open_invite
         FROM (SELECT 1) one LEFT JOIN people p ON p.email = $1`,
        [email],
      );
      const row = r.rows[0]!;
      if (row.has_login || row.open_invite) {
        console.log(`bootstrap admin: ${email} already has a login or an open invite, skipping`);
      } else {
        await c.query("BEGIN");
        let id = row.id;
        if (!id) {
          const name = process.env.BOOTSTRAP_ADMIN_NAME ?? email;
          const hire = process.env.BOOTSTRAP_ADMIN_HIRE_DATE;
          if (!hire) throw new Error("BOOTSTRAP_ADMIN_HIRE_DATE is required to create the admin's person record");
          id = (
            await c.query<{ id: string }>(
              "INSERT INTO people (type, name, email, hire_date, status) VALUES ('employee', $1, $2, $3, 'active') RETURNING id",
              [name, email, hire],
            )
          ).rows[0]!.id;
        }
        await c.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING", [id]);
        const link = await insertInvite(c, id, process.env.BETTER_AUTH_URL!);
        await c.query("COMMIT");
        console.log(`bootstrap admin: one-time invite for ${email} (expires in 72 hours):\n  ${link}`);
      }
    }

    if (process.env.SEED_ON_DEPLOY === "true" && !isProd) {
      const seeded = await c.query("SELECT 1 FROM people WHERE system_key = 'vrh'");
      // A fresh database gets the full seed; an existing one only gets any missing history.
      execFileSync("npx", ["tsx", "scripts/seed.ts", ...(seeded.rowCount ? ["--history"] : [])], { stdio: "inherit", env: process.env });
    }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
