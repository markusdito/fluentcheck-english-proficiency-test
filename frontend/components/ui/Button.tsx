import React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] shadow-sm focus-visible:ring-[var(--primary)]",
  secondary:
    "bg-[var(--accent)] text-white hover:bg-emerald-600 shadow-sm focus-visible:ring-[var(--accent)]",
  outline:
    "border border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-zinc-50 focus-visible:ring-[var(--primary)] dark:bg-transparent dark:hover:bg-zinc-900",
  ghost:
    "text-[var(--foreground)] hover:bg-zinc-100 focus-visible:ring-[var(--primary)] dark:hover:bg-zinc-800",
  danger:
    "bg-[var(--danger)] text-white hover:bg-red-600 shadow-sm focus-visible:ring-[var(--danger)]",
};

const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-12 px-8 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "active:scale-[0.98]",
        variantStyles[variant],
        sizeStyles[size],
        fullWidth ? "w-full" : "",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  );
}