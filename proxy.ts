import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";
import { SESSION } from "@/lib/auth/config";

/**
 * Runs before every protected page:
 *   1. No session → /login.
 *   2. Enforces the absolute session lifetime and, for /admin, the shorter admin idle timeout.
 *      (The holder idle timeout is the session's own sliding expiry.)
 *   3. Refreshes the session so active users stay signed in, passing the new cookie on.
 * MFA, role and passkey checks happen in the page guards (lib/auth/guards.ts).
 */
export async function proxy(request: NextRequest) {
  const auth = getAuth();
  const headers = request.headers;
  const login = new URL("/login", request.url);

  // Read without refreshing, so updatedAt still shows the last activity.
  const current = await auth.api.getSession({ headers, query: { disableRefresh: true } });
  if (!current) {
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  const now = Date.now();
  const createdAt = new Date(current.session.createdAt).getTime();
  const lastActive = new Date(current.session.updatedAt).getTime();
  const isAdminArea = request.nextUrl.pathname.startsWith("/admin");
  const tooOld = now - createdAt > SESSION.maxHours * 3_600_000;
  const adminIdle = isAdminArea && now - lastActive > SESSION.adminIdleMinutes * 60_000 + SESSION.refreshSeconds * 1000;

  if (tooOld || adminIdle) {
    const signOut = await auth.api.signOut({ headers, asResponse: true });
    login.searchParams.set("reason", "timeout");
    const res = NextResponse.redirect(login);
    for (const c of signOut.headers.getSetCookie()) res.headers.append("set-cookie", c);
    return res;
  }

  const refreshed = await auth.api.getSession({ headers, asResponse: true });
  const res = NextResponse.next();
  for (const c of refreshed.headers.getSetCookie()) res.headers.append("set-cookie", c);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/mfa/:path*", "/account/:path*"],
};
