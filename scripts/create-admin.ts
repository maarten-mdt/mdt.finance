/**
 * Grant the admin role to a person (creating them if needed) and print a one-time invite link.
 * Admins then sign in, set up an authenticator app, and add a passkey on first visit to /admin.
 *
 *   npm run admin:create -- --email maarten@mdttac.com --name "Maarten" --hire-date 2010-01-01
 *
 * Env: DATABASE_OWNER_URL, BETTER_AUTH_URL
 */
import { arg, insertInvite, ownerClient } from "./lib";

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const hire = arg("hire-date");
  const baseUrl = process.env.BETTER_AUTH_URL;
  if (!email || !baseUrl) throw new Error("Usage: --email <email> [--name <name> --hire-date YYYY-MM-DD]; BETTER_AUTH_URL must be set");

  const c = await ownerClient("system:create-admin");
  try {
    await c.query("BEGIN");
    let person = (await c.query<{ id: string }>("SELECT id FROM people WHERE email = $1", [email])).rows[0];
    if (!person) {
      if (!name || !hire) throw new Error(`${email} isn't in people yet: pass --name and --hire-date to create them`);
      person = (
        await c.query<{ id: string }>(
          "INSERT INTO people (type, name, email, hire_date, status) VALUES ('employee', $1, $2, $3, 'active') RETURNING id",
          [name, email, hire],
        )
      ).rows[0]!;
      console.log(`Created person ${name} <${email}>`);
    }
    await c.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING", [person.id]);
    const link = await insertInvite(c, person.id, baseUrl);
    await c.query("COMMIT");
    console.log(`${email} is an admin. One-time sign-up link (expires in 72 hours):\n\n  ${link}\n`);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
