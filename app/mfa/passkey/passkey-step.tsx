"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { authClient, errorMessage } from "@/lib/auth/client";

export function PasskeyStep({ mode }: { mode: "register" | "verify" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    if (mode === "register") {
      const { error } = await authClient.passkey.addPasskey({ name: "Admin passkey" });
      if (error) {
        setBusy(false);
        return setError(errorMessage(error, "The passkey wasn't saved."));
      }
    }
    const { error } = await authClient.signIn.passkey();
    setBusy(false);
    if (error) return setError(errorMessage(error, "Passkey sign-in was cancelled or failed."));
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Button onClick={go} disabled={busy} className="w-full">
        {busy ? "Waiting for your device…" : mode === "register" ? "Add a passkey and continue" : "Use my passkey"}
      </Button>
      <a href="/dashboard" className="block text-center text-sm text-muted underline-offset-4 hover:underline">
        Back to my dashboard
      </a>
    </div>
  );
}
