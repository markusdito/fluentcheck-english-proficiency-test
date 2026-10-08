"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Check, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { AuthField } from "@/components/auth/AuthField";
import { errorSummary, primaryButton } from "@/components/auth/styles";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { GoogleAuthError } from "@/components/auth/GoogleAuthError";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { SessionUser } from "@/types/auth";

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
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");

  function normalizeUsername(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_]/g, "");
  }
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
      const response = await api.post<{ data: { user: SessionUser } }>("/auth/register", {
        username: normalizeUsername(username),
        email,
        password,
      });
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, response.data.user);
      router.push(response.data.user.role === "ADMIN" ? "/admin" : "/dashboard");
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
    <div>
      <GoogleAuthError />
      <GoogleAuthButton returnTo="signup" dividerLabel="or use your email" />

      <form onSubmit={handleSubmit} noValidate aria-label="Sign up form" className="grid gap-[18px]">
        {error && (
          <p role="alert" className={errorSummary}>
            {error}
          </p>
        )}

        <AuthField
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
          hint="Lowercase letters, numbers and underscores only."
          required
          disabled={loading}
        />

        <AuthField
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
        />

        <AuthField
          id="password"
          label="Password"
          reveal
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearFieldError("password");
          }}
          error={fieldErrors.password?.[0]}
          hint="At least 8 characters."
          required
          disabled={loading}
        >
          <StrengthMeter score={passwordScore(password)} />
        </AuthField>

        <AuthField
          id="confirmPassword"
          label="Confirm password"
          reveal
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            clearFieldError("confirmPassword");
          }}
          error={fieldErrors.confirmPassword?.[0]}
          required
          disabled={loading}
        >
          {confirmPassword && confirmPassword === password && (
            <p className="inline-flex items-center gap-1.5 text-[13px] text-sn-ink-green">
              <Check className="size-3.5" strokeWidth={2.4} aria-hidden />
              Passwords match
            </p>
          )}
        </AuthField>

        <button type="submit" disabled={loading} aria-busy={loading || undefined} className={primaryButton}>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          <span>{loading ? "Creating account…" : "Create account"}</span>
        </button>
      </form>
    </div>
  );
}

/** 0 = empty, 1–4 = weak to strong. Visual only; the schema enforces the real rule. */
export function passwordScore(p: string): number {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (/\d/.test(p) && /[a-z]/i.test(p)) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p) || p.length >= 14) s++;
  return Math.max(1, s);
}

const meterColor = ["", "bg-sn-danger", "bg-sn-amber", "bg-sn-green", "bg-sn-ink-green"];

function StrengthMeter({ score }: { score: number }) {
  return (
    <div aria-hidden="true" className="mt-1 grid grid-cols-4 gap-1">
      {[1, 2, 3, 4].map((i) => (
        <i
          key={i}
          className={`h-1 rounded-xs transition-colors duration-200 ease-standard ${i <= score ? meterColor[score] : "bg-sn-border"}`}
        />
      ))}
    </div>
  );
}
