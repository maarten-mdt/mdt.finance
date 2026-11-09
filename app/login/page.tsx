import { AuthShell } from "@/components/ui";
import { LoginForm } from "./login-form";

const reasons: Record<string, string> = {
  timeout: "You were signed out after a period of inactivity.",
  mfa: "Please sign in again with your authenticator code.",
  unlinked: "Your account isn't linked to a shareholder record. Contact an administrator.",
  signed_out: "You've been signed out.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return (
    <AuthShell title="Sign in">
      <LoginForm notice={reason ? reasons[reason] : undefined} next={safeNext} />
    </AuthShell>
  );
}
