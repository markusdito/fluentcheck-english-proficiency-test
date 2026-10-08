"use client";

import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useSession } from "@/hooks/useSession";

export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const session = useSession();

  useEffect(() => {
    if (session.data) {
      window.location.href = session.data.role === "ADMIN" ? "/admin" : "/dashboard";
    }
  }, [session.data]);

  if (session.isPending || session.data) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
      </div>
    );
  }

  return children;
}
