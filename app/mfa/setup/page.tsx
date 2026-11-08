import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { getCurrentSession } from "@/lib/auth/guards";
import { TotpSetup } from "./totp-setup";

export default async function MfaSetupPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.twoFactorEnabled) redirect("/dashboard");
  return (
    <AuthShell
      title="Set up two-step sign-in"
      subtitle="Every account needs an authenticator app, such as Google Authenticator, 1Password or Microsoft Authenticator."
    >
      <TotpSetup />
    </AuthShell>
  );
}
