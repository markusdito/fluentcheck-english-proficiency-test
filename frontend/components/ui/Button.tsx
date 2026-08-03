import React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "invert";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
  href?: string;
  children: React.ReactNode;
}

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-ink text-paper hover:bg-signal focus-visible:ring-signal shadow-sm",
  secondary:
    "bg-verified text-white hover:bg-verified/90 focus-visible:ring-verified shadow-sm",
  outline:
    "border border-rule-strong bg-transparent text-ink hover:border-signal hover:text-signal focus-visible:ring-signal",
  ghost:
    "text-ink-soft hover:bg-ink/5 hover:text-ink focus-visible:ring-ink",
  danger:
    "bg-signal text-white hover:bg-signal/90 focus-visible:ring-signal shadow-sm",
  invert:
    "bg-paper text-ink hover:bg-paper/90 hover:text-signal focus-visible:ring-paper",
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
  href,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-all",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "active:scale-[0.98]",
    variantStyles[variant],
    sizeStyles[size],
    fullWidth ? "w-full" : "",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes} {...(rest as object)}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={classes}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  );
}