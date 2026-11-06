import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const allowed = new Set(["timeout", "mfa", "unlinked", "signed_out"]);

async function signOut(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason") ?? "signed_out";
  const res = NextResponse.redirect(new URL(`/login?reason=${allowed.has(reason) ? reason : "signed_out"}`, request.url), 303);
  try {
    const out = await getAuth().api.signOut({ headers: request.headers, asResponse: true });
    for (const c of out.headers.getSetCookie()) res.headers.append("set-cookie", c);
  } catch {
    // Already signed out.
  }
  return res;
}

export const GET = signOut;
export const POST = signOut;
