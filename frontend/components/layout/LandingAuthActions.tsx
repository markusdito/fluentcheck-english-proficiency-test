"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";

export function LandingAuthActions() {
  const session = useSession();

  if (session.isPending) {
    return (
      <span
        className="block h-9 w-32 motion-safe:animate-pulse bg-rule"
        role="status"
        aria-label="Checking session"
      />
    );
  }

  if (session.data) {
    return (
      <Button
        variant="default"
        size="sm"
        className="border-ink bg-ink px-6 text-paper shadow-[7px_7px_0_rgba(27,36,32,0.32)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:bg-ink hover:shadow-[10px_10px_0_rgba(27,36,32,0.38)] active:translate-y-0 active:shadow-[3px_3px_0_rgba(27,36,32,0.28)]"
        render={
          <Link
            href={session.data.role === "ADMIN" ? "/admin" : "/dashboard"}
          />
        }
      >
        Dashboard
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-1.5 text-[11px] sm:h-9 sm:px-4 sm:text-sm"
        aria-label="Sign in"
        render={<Link href="/login" />}
      >
        Sign in
      </Button>
      <Button
        variant="default"
        size="sm"
        className="h-8 px-1.5 text-[11px] sm:h-9 sm:px-4 sm:text-sm"
        render={<Link href="/signup" />}
      >
        Start your assessment
      </Button>
    </>
  );
}
