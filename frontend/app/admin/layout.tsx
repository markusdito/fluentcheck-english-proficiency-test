"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, MenuIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

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

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function AdminNav({ pathname }: { pathname: string }) {
  return (
    <>
      <nav className="hidden items-center gap-1 md:flex" aria-label="Admin">
        {navItems.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
                active
                  ? "border-b-2 border-ink text-ink"
                  : "text-ink-soft hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Admin menu"
            >
              <MenuIcon />
            </Button>
          }
        />
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle>Admin</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-2" aria-label="Admin (mobile)">
            {navItems.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors",
                    active
                      ? "bg-ink text-paper"
                      : "text-ink-soft hover:bg-rule/40 hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AdminBreadcrumb({ pathname }: { pathname: string }) {
  const page = navItems.find(
    (i) => i.href !== "/admin" && pathname.startsWith(i.href),
  );
  const detailLabel = pathname.startsWith("/admin/submissions/")
    ? "Submission details"
    : null;
  return (
    <Breadcrumb className="mb-6">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href="/dashboard" />}>Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href="/admin" />}>Admin</BreadcrumbLink>
        </BreadcrumbItem>
        {page && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {detailLabel ? (
                <BreadcrumbLink render={<Link href={page.href} />}>
                  {page.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{page.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {detailLabel && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{detailLabel}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

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
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <Header
        logoHref="/admin"
        nav={<AdminNav pathname={pathname} />}
        actions={
          <AccountMenu
            name={user?.name}
            email={user?.email}
            isAdmin={user?.role === "ADMIN"}
          />
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <AdminBreadcrumb pathname={pathname} />
        {children}
      </main>
    </div>
  );
}
