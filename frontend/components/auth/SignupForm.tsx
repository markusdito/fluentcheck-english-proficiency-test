"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const signupSchema = z
  .object({
    username: z
      .string()
      .min(1, "Username is required")
      .max(50, "Username is too long")
      .regex(/^[a-z0-9_]+$/, "Username can only contain lowercase letters, numbers, and underscores"),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupFormErrors = Partial<
  z.inferFlattenedErrors<typeof signupSchema>["fieldErrors"]
>;

export function SignupForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");

    function normalizeUsername(value: string): string {
      return value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    }
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SignupFormErrors>({});
  const [loading, setLoading] = useState(false);

  function clearFieldError(field: keyof SignupFormErrors) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validate(): boolean {
    const result = signupSchema.safeParse({
      username,
      email,
      password,
      confirmPassword,
    });
    if (result.success) {
      setFieldErrors({});
      return true;
    }
    setFieldErrors(result.error.flatten().fieldErrors as SignupFormErrors);
    return false;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setLoading(true);
    try {
      const response = await api.post<{ data: { user: unknown; token: string } }>("/auth/register", {
        username: normalizeUsername(username),
        email,
        password,
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
        if (err.statusCode === 409) {
          setError("An account with this email already exists.");
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
    <form onSubmit={handleSubmit} noValidate aria-label="Sign up form">
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
        {/* Username */}
        <Input
          id="name"
          label="Username"
          type="text"
          autoComplete="username"
          placeholder="janesmith92"
          value={username}
          onChange={(e) => {
            setUsername(normalizeUsername(e.target.value));
            clearFieldError("username");
          }}
          error={fieldErrors.username?.[0]}
          helperText="Lowercase letters, numbers, and underscores only — no spaces"
          required
          disabled={loading}
          icon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
            </svg>
          }
        />

        {/* Email */}
        <Input
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearFieldError("email");
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

        {/* Password */}
        <div>
          <Input
            id="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearFieldError("password");
            }}
            error={fieldErrors.password?.[0]}
            helperText="Must be at least 8 characters"
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
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="mt-1.5 text-xs font-medium text-[var(--primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? "Hide password" : "Show password"}
          </button>
        </div>

        {/* Confirm password */}
        <Input
          id="confirmPassword"
          label="Confirm password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            clearFieldError("confirmPassword");
          }}
          error={fieldErrors.confirmPassword?.[0]}
          required
          disabled={loading}
        />

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
        {loading ? "Creating account…" : "Create account"}
      </Button>

      {/* Footer links */}
      <p className="mt-6 text-center text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}