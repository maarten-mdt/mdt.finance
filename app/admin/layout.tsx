import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { requireAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const nav = [
  { href: "/admin", label: "People" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/transfers", label: "Buy / sell" },
  { href: "/admin/dividends", label: "Dividends" },
  { href: "/admin/agreements", label: "Agreements" },
  { href: "/admin/holders", label: "VRH & opening balances" },
  { href: "/admin/audit", label: "Audit log" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdmin();
  return (
    <>
      <AppHeader name={viewer.session.user.name} isAdmin area="admin" />
      <nav className="border-b border-line bg-white">
        <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 text-sm">
          {nav.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="block whitespace-nowrap px-3 py-2.5 text-muted hover:text-ink">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </>
  );
}
