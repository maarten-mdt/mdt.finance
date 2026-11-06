import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./server";
import { AUTH_METHOD, MFA_METHODS } from "./config";
import { withContext, type DbContext } from "@/lib/db";

type Session = NonNullable<Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>>;

export interface Viewer {
  session: Session;
  personId: string;
  isAdmin: boolean;
}

/** The current session, read without refreshing (proxy.ts already refreshed it). */
export const getCurrentSession = cache(async (): Promise<Session | null> => {
  return getAuth().api.getSession({ headers: await headers(), query: { disableRefresh: true } });
});

const hasAdminRole = cache(async (personId: string): Promise<boolean> => {
  const r = await withContext({ personId, actorId: personId, isAdmin: false }, (tx) =>
    tx.query("SELECT 1 FROM user_roles WHERE person_id = $1 AND role = 'admin'", [personId]),
  );
  return (r.rowCount ?? 0) > 0;
});

/** Signed in, with MFA turned on and used for this session. */
export async function requireViewer(): Promise<Viewer> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.user.twoFactorEnabled) redirect("/mfa/setup");
  const method = (session.session as { authMethod?: string | null }).authMethod ?? "";
  if (!MFA_METHODS.includes(method)) redirect("/logout?reason=mfa");
  const personId = (session.user as { personId?: string | null }).personId;
  if (!personId) redirect("/logout?reason=unlinked");
  return { session, personId, isAdmin: await hasAdminRole(personId) };
}

/** Admin role, and this session was opened with a passkey. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) redirect("/dashboard");
  const method = (viewer.session.session as { authMethod?: string | null }).authMethod;
  if (method !== AUTH_METHOD.passkey) {
    const passkeys = await getAuth().api.listPasskeys({ headers: await headers() });
    redirect(passkeys.length === 0 ? "/mfa/passkey" : "/mfa/passkey?verify=1");
  }
  return viewer;
}

/** Database context for the signed-in holder: RLS limits every query to their own rows. */
export function holderContext(v: Viewer): DbContext {
  return { personId: v.personId, actorId: v.personId, isAdmin: false };
}

/** Database context for an admin action. The database re-checks the admin role. */
export function adminContext(v: Viewer): DbContext {
  return { personId: v.personId, actorId: v.personId, isAdmin: true };
}
