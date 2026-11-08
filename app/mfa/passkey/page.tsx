import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { requireViewer } from "@/lib/auth/guards";
import { PasskeyStep } from "./passkey-step";

/** Admins must add a passkey, then sign in with it, before the admin console opens. */
export default async function PasskeyPage({ searchParams }: { searchParams: Promise<{ verify?: string }> }) {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) redirect("/dashboard");
  const { verify } = await searchParams;
  return (
    <AuthShell
      title={verify ? "Confirm with your passkey" : "Add a passkey"}
      subtitle={
        verify
          ? "The admin console needs a passkey sign-in."
          : "Administrators use a passkey (Face ID, Touch ID, Windows Hello or a security key). It can't be phished."
      }
    >
      <PasskeyStep mode={verify ? "verify" : "register"} />
    </AuthShell>
  );
}
