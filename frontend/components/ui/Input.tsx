import React from "react";
import { cn } from "@/lib/cn";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string;
  error?: string;
  helperText?: string;
  icon?: React.ReactNode;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function Input({
  label,
  error,
  helperText,
  icon,
  id,
  className,
  required,
  ...rest
}: InputProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-sm font-medium text-[var(--foreground)]"
      >
        {label}
        {required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
      </label>

      <div className="relative">
        {icon && (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helperText
                ? `${inputId}-helper`
                : undefined
          }
          className={cn(
            "block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-[var(--foreground)] transition-colors",
            "placeholder:text-[var(--muted)] outline-none",
            "focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)]",
            "disabled:cursor-not-allowed disabled:opacity-60",
            icon ? "pl-10" : "",
            error
              ? "border-[var(--danger)] focus:ring-[var(--danger)] focus:border-[var(--danger)]"
              : "border-[var(--border)]",
            className,
          )}
          {...rest}
        />
      </div>

      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="mt-1.5 text-xs text-[var(--muted)]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}