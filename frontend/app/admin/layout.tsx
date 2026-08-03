"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/questions", label: "Questions" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ status: string; data: { user: User } }>(
          "/auth/me"
        );
        if (cancelled) return;
        if (res.data.user.role !== "ADMIN") {
          router.replace("/dashboard");
          return;
        }
        setUser(res.data.user);
      } catch {
        if (cancelled) return;
        // 401 is handled by the base api (redirects to /login); other errors bail out.
        router.replace("/dashboard");
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="size-8 animate-spin text-ink-faint" />
      </div>
    );
  }

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto grid h-16 max-w-6xl grid-cols-3 items-center gap-6 px-6">
          <Link
            href="/admin"
            className="flex shrink-0 items-center justify-self-start gap-2 text-xl font-bold tracking-tight text-[var(--foreground)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3h2v1a3 3 0 006 0v-1h2a3 3 0 003-3v-1a3 3 0 000-6v-1a3 3 0 00-3-3h-2V5a3 3 0 00-3-3z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </span>
            FluentCheck — Admin
          </Link>

          <nav className="flex min-w-0 items-center justify-self-center gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-200/70 text-[var(--foreground)]"
                      : "text-[var(--muted)] hover:bg-zinc-100 hover:text-[var(--foreground)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center justify-self-end gap-4">
            <span className="hidden text-sm font-medium text-[var(--muted)] sm:block">
              {user?.name}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
