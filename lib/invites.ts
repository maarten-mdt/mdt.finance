import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { INVITE_TTL_HOURS } from "@/lib/auth/config";
import { getAuth } from "@/lib/auth/server";
import { withContext, type DbContext } from "@/lib/db";
import { env } from "@/lib/env";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Create a one-time invite link for a person. Only the token's hash is stored. */
export async function createInvite(ctx: DbContext, personId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await withContext(ctx, (tx) =>
    tx.query(
      `INSERT INTO invites (person_id, token_hash, expires_at)
       SELECT id, $2, now() + make_interval(hours => $3)
       FROM people WHERE id = $1 AND email IS NOT NULL AND status <> 'departed'`,
      [personId, hashToken(token), INVITE_TTL_HOURS],
    ).then((r) => {
      if (r.rowCount !== 1) throw new Error("This person can't be invited (no email, or they have left).");
    }),
  );
  return new URL(`/invite/${token}`, env.baseUrl).toString();
}

const anonymous: DbContext = { personId: null, actorId: "system:invite-acceptance", isAdmin: false };

export async function peekInvite(token: string): Promise<{ name: string; email: string } | null> {
  const r = await withContext(anonymous, (tx) =>
    tx.query<{ name: string; email: string }>("SELECT * FROM app.peek_invite($1)", [hashToken(token)]),
  );
  return r.rows[0] ?? null;
}

/**
 * Use an invite: mark it used, then create (or re-key) the person's login with this password.
 * Returns the email to sign in with, or null if the link is invalid, expired or already used.
 */
export async function acceptInvite(token: string, password: string): Promise<string | null> {
  const r = await withContext(anonymous, (tx) =>
    tx.query<{ person_id: string; name: string; email: string }>("SELECT * FROM app.consume_invite($1)", [hashToken(token)]),
  );
  const person = r.rows[0];
  if (!person) return null;

  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(password);
  const existing = await ctx.internalAdapter.findUserByEmail(person.email, { includeAccounts: true });
  if (existing) {
    const hasCredential = existing.accounts.some((a) => a.providerId === "credential");
    if (hasCredential) await ctx.internalAdapter.updatePassword(existing.user.id, hash);
    else await ctx.internalAdapter.linkAccount({ userId: existing.user.id, providerId: "credential", accountId: existing.user.id, password: hash });
  } else {
    const user = await ctx.internalAdapter.createUser({
      email: person.email,
      name: person.name,
      emailVerified: true,
      personId: person.person_id,
    }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
  }
  return person.email;
}
