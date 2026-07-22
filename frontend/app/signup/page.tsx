"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SignupForm } from "@/components/auth/SignupForm";
import { api, ApiError } from "@/lib/api";

export default function SignupPage() {
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("token")
            : null;
        if (!token) {
          setCheckingAuth(false);
          return;
        }
        await api.get("/auth/me");
        if (!cancelled) {
          window.location.href = "/dashboard";
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          localStorage.removeItem("token");
        }
        setCheckingAuth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 lg:flex-row">
      {/* Skip link for accessibility */}
      <a
        href="#signup-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--primary)] focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to sign up form
      </a>

      {/* Left: brand panel (hidden on mobile) */}
      <aside className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-gradient-to-br from-[var(--primary)] via-blue-700 to-indigo-800 p-12 text-white lg:flex">
        {/* Decorative orbs */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-indigo-300/20 blur-3xl" />

        <Link
          href="/"
          className="relative z-10 flex items-center gap-2 text-2xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-lg"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a3 3 0 00-3 3v1H7a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3h2v1a3 3 0 006 0v-1h2a3 3 0 003-3v-1a3 3 0 000-6v-1a3 3 0 00-3-3h-2V5a3 3 0 00-3-3z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </span>
          FluentCheck
        </Link>

        <div className="relative z-10 max-w-md">
          <h2 className="text-3xl font-bold leading-tight">
            Begin your English assessment journey
          </h2>
          <p className="mt-4 text-lg text-blue-100">
            Create your free account and start practicing with real-world
            speaking prompts designed by language professionals.
          </p>

          {/* Feature bullets */}
          <ul className="mt-8 space-y-4">
            {[
              "Personalized feedback on pronunciation & fluency",
              "Expert jury evaluation for every recording",
              "Track your progress with detailed analytics",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <svg
                  className="mt-0.5 h-6 w-6 flex-shrink-0 text-emerald-300"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-blue-50">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-sm text-blue-200">
          &copy; {new Date().getFullYear()} FluentCheck. All rights reserved.
        </p>
      </aside>

      {/* Right: signup form panel */}
      <main
        id="signup-content"
        className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6"
      >
        <div className="w-full max-w-sm">
          {/* Mobile brand (shown only on small screens) */}
          <Link
            href="/"
            className="mb-8 flex items-center justify-center gap-2 text-2xl font-bold tracking-tight text-[var(--foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded-lg lg:hidden"
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
            FluentCheck
          </Link>

          {/* Card */}
          <div className="animate-fade-in-up rounded-xl border border-[var(--border)] bg-white p-8 shadow-lg shadow-zinc-200/50">
            <h1 className="mb-1 text-2xl font-semibold text-[var(--foreground)]">
              Create your account
            </h1>
            <p className="mb-6 text-sm text-[var(--muted)]">
              Start your English proficiency journey
            </p>

            <SignupForm />
          </div>
        </div>
      </main>
    </div>
  );
}