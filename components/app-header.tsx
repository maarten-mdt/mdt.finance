import Link from "next/link";

export function AppHeader({ name, isAdmin, area }: { name: string; isAdmin: boolean; area: "holder" | "admin" }) {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href={area === "admin" ? "/admin" : "/dashboard"} className="text-sm font-bold tracking-widest">
          MDT<span className="text-accent">.</span>FINANCE
          {area === "admin" && <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-[10px] tracking-normal text-white">ADMIN</span>}
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {isAdmin && area === "holder" && (
            <Link href="/admin" className="font-medium underline-offset-4 hover:underline">
              Admin
            </Link>
          )}
          {area === "admin" && (
            <Link href="/dashboard" className="font-medium underline-offset-4 hover:underline">
              My shares
            </Link>
          )}
          <span className="hidden text-muted sm:inline">{name}</span>
          <form action="/logout" method="post">
            <button className="text-muted underline-offset-4 hover:underline">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
