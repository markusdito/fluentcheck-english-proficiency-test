"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type AuthState = "checking" | "signed-out" | "signed-in";

interface MeResponse {
  status: string;
  data: {
    user: unknown;
  };
}

export function LandingAuthActions() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let cancelled = false;

    api
      .get<MeResponse>("/auth/me", { redirectOn401: false })
      .then(() => {
        if (!cancelled) setAuthState("signed-in");
      })
      .catch(() => {
        if (!cancelled) setAuthState("signed-out");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "checking") {
    return (
      <span
        className="block h-9 w-32 motion-safe:animate-pulse bg-rule"
        role="status"
        aria-label="Checking session"
      />
    );
  }

  if (authState === "signed-in") {
    return (
      <Button
        variant="default"
        size="sm"
        className="border-ink bg-ink px-6 text-paper shadow-[7px_7px_0_rgba(27,36,32,0.32)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:bg-ink hover:shadow-[10px_10px_0_rgba(27,36,32,0.38)] active:translate-y-0 active:shadow-[3px_3px_0_rgba(27,36,32,0.28)]"
        render={<Link href="/dashboard" />}
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
        aria-label="Sign in"
        render={<Link href="/login" />}
      >
        Sign in
      </Button>
      <Button
        variant="default"
        size="sm"
        render={<Link href="/signup" />}
      >
        Start your assessment
      </Button>
    </>
  );
}
