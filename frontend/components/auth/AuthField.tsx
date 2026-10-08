"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Password field with a show/hide toggle. */
  reveal?: boolean;
  /** Rendered between the input and the hint (e.g. a strength meter). */
  children?: ReactNode;
}

export function AuthField({
  id,
  label,
  error,
  hint,
  reveal = false,
  children,
  type,
  className,
  ...rest
}: AuthFieldProps) {
  const [shown, setShown] = useState(false);
  const describedBy =
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={reveal ? (shown ? "text" : "password") : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "min-h-12 w-full rounded-xl border border-sn-fg/18 bg-sn-surface px-4 py-3 text-base text-sn-fg transition-[border-color,box-shadow] duration-200 ease-standard placeholder:text-sn-muted/70 hover:border-sn-fg/36 focus:border-sn-fg focus:shadow-[0_0_0_3px_rgb(38_38_38/0.1)] focus:outline-none disabled:opacity-60 aria-invalid:border-sn-danger aria-invalid:focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-sn-danger)_16%,transparent)] [&::-ms-clear]:hidden [&::-ms-reveal]:hidden",
            reveal && "pr-14",
            className,
          )}
          {...rest}
        />
        {reveal && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            aria-controls={id}
            className="absolute top-0.5 right-0.5 grid size-11 place-items-center rounded-[10px] text-sn-muted transition-colors duration-200 ease-standard hover:bg-sn-fg/6 hover:text-sn-fg focus-visible:text-sn-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sn-fg"
          >
            {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        )}
      </div>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-[13px] text-sn-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[13px] text-sn-danger">
          {error}
        </p>
      )}
    </div>
  );
}
