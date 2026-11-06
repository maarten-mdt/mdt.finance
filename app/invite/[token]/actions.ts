"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { acceptInvite } from "@/lib/invites";

export interface AcceptState {
  error?: string;
}

export async function acceptInviteAction(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 12) return { error: "Use at least 12 characters." };
  if (password.length > 128) return { error: "Use at most 128 characters." };
  if (password !== confirm) return { error: "The passwords don't match." };

  const email = await acceptInvite(token, password);
  if (!email) return { error: "This link has expired or was already used. Ask an administrator for a new one." };

  // Signs in and sets the session cookie (nextCookies plugin). MFA setup is next.
  await getAuth().api.signInEmail({ body: { email, password }, headers: await headers() });
  redirect("/mfa/setup");
}
