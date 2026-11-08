import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

/** Owner connection for scripts, with the audit actor set for the whole session. */
export async function ownerClient(actor: string): Promise<pg.Client> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is required");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("SELECT set_config('app.actor_id', $1, false)", [actor]);
  return c;
}

/** Same token scheme as lib/invites.ts: the link carries the token, the database a SHA-256 hash. */
export async function insertInvite(c: pg.Client, personId: string, baseUrl: string, ttlHours = 72): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await c.query(
    "INSERT INTO invites (person_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))",
    [personId, createHash("sha256").update(token).digest("hex"), ttlHours],
  );
  return new URL(`/invite/${token}`, baseUrl).toString();
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
