"use client";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { authClient, errorMessage } from "@/lib/auth/client";

export function TotpSetup() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ uri: string; qr: string; secret: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password, method: "totp" });
    setBusy(false);
    if (error || !data || data.method !== "totp") return setError(errorMessage(error, "Couldn't start setup. Check your password."));
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ uri: data.totpURI, qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }), secret, backupCodes: data.backupCodes });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) return setError(errorMessage(error, "That code didn't match. Try the newest one."));
    router.push("/dashboard");
    router.refresh();
  }

  if (!setup) {
    return (
      <form onSubmit={start} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field
          label="Confirm your password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Starting…" : "Continue"}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <ol className="list-decimal space-y-4 pl-5 text-sm">
        <li>
          Scan this code with your authenticator app.
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={220} height={220} className="mt-3 rounded-lg border border-line bg-white p-2" />
          <details className="mt-2 text-muted">
            <summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary>
            <code data-testid="totp-secret" className="mt-1 block break-all rounded bg-white p-2 font-mono text-ink">
              {setup.secret}
            </code>
          </details>
        </li>
        <li>
          Save these one-time backup codes somewhere safe. Each works once if you lose your phone.
          <ul className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-line bg-white p-3 font-mono text-sm">
            {setup.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </li>
        <li>Enter the 6-digit code your app shows now.</li>
      </ol>
      <form onSubmit={confirm} className="space-y-4">
        <Field
          label="Authenticator code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Checking…" : "Turn on two-step sign-in"}
        </Button>
      </form>
    </div>
  );
}
