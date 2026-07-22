"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      const response = await api.post<{ data: { user: unknown; token: string } }>("/auth/login", {
        email,
        password,
        rememberMe,
      });
      // Save token to localStorage so dashboard/auth-guard can find it
      const token = response?.data?.token;
      if (token) {
        localStorage.setItem("token", token);
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 401) {
          setError("Invalid email or password. Please try again.");
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
    <form onSubmit={handleSubmit} noValidate aria-label="Login form">
      {/* Server / general error */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.94 7.94a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM8 10a.75.75 0 01.75-.75h.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-2.75H8.75A.75.75 0 018 10z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4">
        <Input
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) {
              setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }
          }}
          error={fieldErrors.email?.[0]}
          required
          disabled={loading}
          icon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2.5 5A2.5 2.5 0 015 2.5h10A2.5 2.5 0 0117.5 5v10a2.5 2.5 0 01-2.5 2.5H5A2.5 2.5 0 012.5 15V5zM5 4a1 1 0 00-1 1v.217l6 3.75 6-3.75V5a1 1 0 00-1-1H5z" />
            </svg>
          }
        />

        <div>
          <Input
            id="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }
            }}
            error={fieldErrors.password?.[0]}
            required
            disabled={loading}
            icon={
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 1a4 4 0 00-4 4v2H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-1V5a4 4 0 00-4-4zm2 6V5a2 2 0 10-4 0v2h4z"
                  clipRule="evenodd"
                />
              </svg>
            }
          />
          {/* Password visibility toggle */}
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="mt-1.5 text-xs font-medium text-[var(--primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? "Hide password" : "Show password"}
          </button>
        </div>

        {/* Remember me + forgot password */}
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)] select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)] focus:ring-offset-0"
            />
            Remember me
          </label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-[var(--primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      {/* Submit */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={loading}
        fullWidth
        className="mt-6"
      >
        {loading ? "Signing in…" : "Sign in"}
      </Button>

      {/* Footer links */}
      <p className="mt-6 text-center text-sm text-[var(--muted)]">
        {"Don't have an account? "}
        <Link
          href="/signup"
          className="font-medium text-[var(--primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}