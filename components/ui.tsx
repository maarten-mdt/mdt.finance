import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <Link href="/" className="text-sm font-bold tracking-widest">
        MDT<span className="text-accent">.</span>FINANCE
      </Link>
      <main className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-2 text-muted">{subtitle}</div>}
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = props.id ?? `f-${props.name ?? label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        {...props}
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-3 text-base outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-ink text-white hover:bg-ink/90",
    secondary: "border border-line bg-white text-ink hover:bg-paper",
    danger: "bg-danger text-white hover:bg-danger/90",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "ok"; children: ReactNode }) {
  const styles = {
    error: "border-danger/30 bg-danger/5 text-danger",
    info: "border-line bg-white text-ink",
    ok: "border-ok/30 bg-ok/5 text-ok",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = "", flush = false }: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-white ${flush ? "overflow-hidden" : "p-4 sm:p-5"} ${className}`}>{children}</section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
    </div>
  );
}
