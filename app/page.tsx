import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 py-6">
      <header className="flex items-center justify-between text-sm">
        <span className="font-bold tracking-widest">
          MDT<span className="text-accent">.</span>FINANCE
        </span>
        <Link href="/login" className="text-muted underline-offset-4 hover:underline">
          Sign in
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <p className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          Launching soon
        </p>
        <h1 className="max-w-[14ch] text-5xl font-bold leading-none tracking-tight sm:text-7xl">
          Something new is on the way.
        </h1>
        <p className="mt-6 max-w-[52ch] text-lg text-muted">
          We&apos;re putting the finishing touches on MDT Finance. Check back shortly.
        </p>
      </main>
      <footer className="border-t border-line pt-5 text-sm text-muted">© MDT Finance</footer>
    </div>
  );
}
