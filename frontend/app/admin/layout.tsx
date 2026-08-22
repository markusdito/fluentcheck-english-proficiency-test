"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Header } from "@/components/layout/Header";
import { AccountMenu } from "@/components/layout/AccountMenu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import {
  adminNavigationItems,
  isAdminNavigationItemActive,
} from "@/lib/admin-navigation";

function AdminNav({ pathname }: { pathname: string }) {
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Admin">
      {adminNavigationItems.map((item) => {
        const active = isAdminNavigationItemActive(pathname, item);
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
  );
}

function AdminBreadcrumb({ pathname }: { pathname: string }) {
  const page = adminNavigationItems.find(
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
  const session = useSession({ required: true });
  const user = session.data;

  useEffect(() => {
    if (user && user.role !== "ADMIN") {
      router.replace("/dashboard");
    } else if (
      session.error &&
      !(session.error instanceof ApiError && session.error.statusCode === 401)
    ) {
      router.replace("/dashboard");
    }
  }, [router, session.error, user]);

  if (session.isPending || !user || user.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <Header
        logoHref="/"
        nav={<AdminNav pathname={pathname} />}
        actions={
          <AccountMenu
            name={user?.name}
            email={user?.email}
            isAdmin={user?.role === "ADMIN"}
            showDashboard={false}
            navigationItems={adminNavigationItems.map((item) => ({
              href: item.href,
              label: item.label,
              current: isAdminNavigationItemActive(pathname, item),
            }))}
            navigationClassName="md:hidden"
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
