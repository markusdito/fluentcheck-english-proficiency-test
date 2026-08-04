"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

export interface FormFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string
  error?: string
  helperText?: string
  icon?: React.ReactNode
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * Brand form field: ruled (borderless bottom-rule) input with a mono uppercase
 * micro-label, optional leading icon, and error / helper text. Built on the
 * shadcn `Input` primitive so every field stays inside the one component system.
 */
export function FormField({
  label,
  error,
  helperText,
  icon,
  id,
  className,
  required,
  ...rest
}: FormFieldProps) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft"
      >
        {label}
        {required && <span className="ml-0.5 text-signal">*</span>}
      </label>

      <div className="relative">
        {icon && (
          <span
            className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <Input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helperText
                ? `${inputId}-helper`
                : undefined
          }
          data-invalid={error ? "true" : undefined}
          className={cn(
            "ruled-field h-auto border-0 rounded-none bg-transparent px-0 text-sm shadow-none",
            icon ? "pl-7!" : "",
            className,
          )}
          {...rest}
        />
      </div>

      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-signal">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="mt-1.5 text-xs text-ink-faint">
          {helperText}
        </p>
      ) : null}
    </div>
  )
}
