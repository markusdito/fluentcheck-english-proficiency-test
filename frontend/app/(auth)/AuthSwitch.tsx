"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const tabs = [
  { href: "/login", label: "Sign in" },
  { href: "/signup", label: "Create account" },
];

/* Sign in / Create account pill switch; the knob slides because the layout persists across routes. */
export function AuthSwitch() {
  const pathname = usePathname();
  const onSignup = pathname === "/signup";

  return (
    <nav
      aria-label="Choose account action"
      className="relative mb-7 grid grid-cols-2 rounded-full border border-sn-border bg-sn-surface p-1 sm:mb-9"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-sn-fg transition-transform duration-320 ease-spring motion-reduce:transition-none",
          onSignup && "translate-x-full",
        )}
      />
      {tabs.map((t) => {
        const current = (t.href === "/signup") === onSignup;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "relative z-1 inline-flex min-h-11 items-center justify-center rounded-full text-[15px] font-medium transition-colors duration-240 ease-standard",
              current ? "text-sn-surface" : "text-sn-muted hover:text-sn-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
