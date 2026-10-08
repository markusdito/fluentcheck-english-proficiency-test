"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useSession } from "@/hooks/useSession";
import { PageShell, PageState } from "@/components/student/PageShell";
import { focusRing } from "@/components/student/styles";
import { cn } from "@/lib/cn";
import {
  adminNavigationItems,
  isAdminNavigationItemActive,
} from "@/lib/admin-navigation";

function AdminTabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Admin sections" className="mb-10 flex flex-wrap gap-1 border-b border-sn-border">
      {adminNavigationItems.map((item) => {
        const active = isAdminNavigationItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center rounded-t-xl border-b-2 px-4 py-3 text-[15px] transition-colors duration-200",
              focusRing,
              active
                ? "border-sn-fg font-medium text-sn-fg"
                : "border-transparent text-sn-muted hover:text-sn-fg",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
      <PageState>
        <Loader2 className="mx-auto size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
      </PageState>
    );
  }

  return (
    <PageShell
      name={user.name}
      email={user.email}
      label="Admin"
      homeHref="/admin"
      contentId="admin-content"
      skipLabel="Skip to admin content"
    >
      <AdminTabs pathname={pathname} />
      {children}
    </PageShell>
  );
}
