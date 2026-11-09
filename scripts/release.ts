/**
 * Railway pre-deploy step. Runs inside Railway's private network before each deploy:
 *   1. Apply migrations (always).
 *   2. If BOOTSTRAP_ADMIN_EMAIL is set and that admin has no login yet and no unused invite:
 *      create them as an admin and print a one-time invite link to the deploy log.
 *   3. If RECOVER_ACCOUNT=<email>:<one-time code> is set and that code hasn't been used: lock-out
 *      recovery for that account (see recoverAccount below).
 *   4. If SEED_ON_DEPLOY=true and APP_ENV is not production: seed fake data once, and add any
 *      missing seed history to an existing seed.
 *
 * Env: DATABASE_OWNER_URL, APP_DB_PASSWORD, AUTH_DB_PASSWORD, BETTER_AUTH_URL, APP_ENV,
 *      SEED_ON_DEPLOY, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_HIRE_DATE,
 *      RECOVER_ACCOUNT
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

    if (process.env.RECOVER_ACCOUNT) await recoverAccount(c, process.env.RECOVER_ACCOUNT);

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

/**
 * Lock-out recovery, run by whoever can set Railway variables (the same people who can reach the
 * database). For the account with this email: turn off two-step sign-in, remove passkeys, end
 * every session, and print a one-time reset link. Using the link sets a new password and goes
 * through authenticator setup again. The code after the colon makes each request run once, even
 * if the variable is left set; every recovery is written to the audit log.
 */
async function recoverAccount(c: Awaited<ReturnType<typeof ownerClient>>, spec: string) {
  const i = spec.lastIndexOf(":");
  const email = spec.slice(0, i).trim().toLowerCase();
  const code = spec.slice(i + 1).trim();
  if (i < 1 || code.length < 6) throw new Error("RECOVER_ACCOUNT must look like email:one-time-code (code at least 6 characters)");

  const done = await c.query(
    "SELECT 1 FROM audit_log WHERE action = 'account.recovery' AND after ->> 'code' = $1",
    [code],
  );
  if (done.rowCount) {
    console.log(`account recovery: code already used, skipping (remove RECOVER_ACCOUNT from the variables)`);
    return;
  }
  const row = (
    await c.query<{ person_id: string; user_id: string | null }>(
      `SELECT p.id AS person_id, u.id AS user_id FROM people p LEFT JOIN "user" u ON u."personId" = p.id WHERE p.email = $1`,
      [email],
    )
  ).rows[0];
  if (!row) throw new Error(`account recovery: no person with email ${email}`);

  await c.query("BEGIN");
  await c.query("SELECT set_config('app.actor_id', 'system:account-recovery', true)");
  if (row.user_id) {
    await c.query('DELETE FROM "twoFactor" WHERE "userId" = $1', [row.user_id]);
    await c.query('DELETE FROM "passkey" WHERE "userId" = $1', [row.user_id]);
    await c.query('DELETE FROM "session" WHERE "userId" = $1', [row.user_id]);
    await c.query('UPDATE "user" SET "twoFactorEnabled" = false WHERE id = $1', [row.user_id]);
  }
  // Older unused links for this person stop working.
  await c.query("UPDATE invites SET expires_at = now() WHERE person_id = $1 AND used_at IS NULL AND expires_at > now()", [row.person_id]);
  await c.query("SELECT app.log_event('account.recovery', 'people', $1, $2)", [row.person_id, JSON.stringify({ code })]);
  const link = await insertInvite(c, row.person_id, process.env.BETTER_AUTH_URL!);
  await c.query("COMMIT");
  console.log(`account recovery: two-step sign-in, passkeys and sessions cleared for ${email}. One-time reset link (expires in 72 hours):\n  ${link}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
