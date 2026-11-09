"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { authClient, errorMessage } from "@/lib/auth/client";

export function LoginForm({ notice, next }: { notice?: string; next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) return setError(errorMessage(error, "Email or password is incorrect."));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("totp");
    // No MFA yet (first sign-in): set it up before anything else.
    router.push("/mfa/setup");
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) return setError(errorMessage(error, "That code didn't work. Try the newest one."));
    router.push(next);
    router.refresh();
  }

  async function passkey() {
    setError(null);
    const { error } = await authClient.signIn.passkey();
    if (error) return setError(errorMessage(error, "Passkey sign-in was cancelled or failed."));
    router.push(next === "/dashboard" ? "/admin" : next);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {notice && <Alert tone="info">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {step === "password" ? (
        <form onSubmit={submitPassword} className="space-y-4">
          <Field label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Continue"}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4">
          <Field
            label="Authenticator code"
            hint="The 6-digit code from your authenticator app."
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Checking…" : "Sign in"}
          </Button>
        </form>
      )}

      <div className="border-t border-line pt-6">
        <Button type="button" variant="secondary" className="w-full" onClick={passkey}>
          Sign in with a passkey
        </Button>
      </div>
    </div>
  );
}
