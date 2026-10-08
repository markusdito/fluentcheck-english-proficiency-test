"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { AuthField } from "@/components/auth/AuthField";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { GoogleAuthError } from "@/components/auth/GoogleAuthError";
import { errorSummary, primaryButton, signInButtonSpace, textLink } from "@/components/auth/styles";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { SessionUser } from "@/types/auth";

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormErrors = Partial<z.inferFlattenedErrors<typeof loginSchema>["fieldErrors"]>;

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LoginFormErrors>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const result = loginSchema.safeParse({ email, password });
    if (result.success) {
      setFieldErrors({});
      return true;
    }
    setFieldErrors(result.error.flatten().fieldErrors as LoginFormErrors);
    return false;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setLoading(true);
    try {
      const response = await api.post<{ data: { user: SessionUser } }>("/auth/login", {
        email,
        password,
        rememberMe,
      });
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, response.data.user);
      router.push(response.data.user.role === "ADMIN" ? "/admin" : "/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 401) {
          setError("Email or password is incorrect. Try again or reset your password.");
          setPassword("");
        } else if (err.statusCode >= 500) {
          setError("Server error. Please try again in a moment.");
        } else {
          setError(err.message);
        }
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <GoogleAuthError />
      <GoogleAuthButton returnTo="login" dividerLabel="or sign in with email" />

      <form onSubmit={handleSubmit} noValidate aria-label="Login form" className="grid gap-[18px]">
        {error && (
          <p role="alert" className={errorSummary}>
            {error}
          </p>
        )}

        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
          }}
          error={fieldErrors.email?.[0]}
          required
          disabled={loading}
        />

        <AuthField
          id="password"
          label="Password"
          reveal
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
          }}
          error={fieldErrors.password?.[0]}
          required
          disabled={loading}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading}
              className="size-[18px] accent-sn-fg"
            />
            Remember me
          </label>
          <Link href="/forgot-password" className={textLink}>
            Forgot password?
          </Link>
        </div>

        <div className={signInButtonSpace}>
          <button type="submit" disabled={loading} aria-busy={loading || undefined} className={primaryButton}>
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{loading ? "Signing in…" : "Sign in"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
