import { Buffer } from "node:buffer";
import { z } from "zod";

const BCRYPT_MAX_BYTES = 72;
const LOGIN_PASSWORD_MAX_BYTES = 1024;
const EMAIL_MAX_LENGTH = 254;
const USERNAME_PATTERN = /^[a-z0-9_]+$/u;
const ASCII_EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;

export const AUTH_VALIDATION_ERROR = "Invalid request";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasUtf8BytesAtMost(value: string, maxBytes: number): boolean {
  return Buffer.byteLength(value, "utf8") <= maxBytes;
}

function isConventionalAsciiEmail(email: string): boolean {
  if (!ASCII_EMAIL_PATTERN.test(email)) return false;

  const [localPart] = email.split("@");
  return (
    localPart.length <= 64 &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..")
  );
}

const usernameSchema = z
  .string({ error: "Username must be a string" })
  .trim()
  .toLowerCase()
  .min(1, "Username is required")
  .max(50, "Username must be at most 50 characters")
  .regex(USERNAME_PATTERN, "Username can only contain lowercase letters, numbers, and underscores");

const emailSchema = z
  .string({ error: "Email must be a string" })
  .trim()
  .max(EMAIL_MAX_LENGTH, "Email must be at most 254 characters")
  .refine(isConventionalAsciiEmail, "Enter a valid email address");

const registrationPasswordSchema = z
  .string({ error: "Password must be a string" })
  .min(8, "Password must be at least 8 characters")
  .refine(
    (password) => hasUtf8BytesAtMost(password, BCRYPT_MAX_BYTES),
    "Password must not exceed 72 UTF-8 bytes",
  );

const loginPasswordSchema = z
  .string({ error: "Password must be a string" })
  .min(1, "Password is required")
  .refine(
    (password) => hasUtf8BytesAtMost(password, LOGIN_PASSWORD_MAX_BYTES),
    "Password must not exceed 1024 UTF-8 bytes",
  );

const registrationInputSchema = z.strictObject({
  username: usernameSchema,
  email: emailSchema,
  password: registrationPasswordSchema,
});

const loginInputSchema = z.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
  rememberMe: z.boolean({ error: "rememberMe must be a boolean" }).default(false),
});

// PRD FR-1.4: full name and Student ID spoken in the system-check identity clip.
export const profileSchema = z.strictObject({
  fullName: z
    .string({ error: "Full name must be a string" })
    .trim()
    .min(1, "Full name is required")
    .max(100, "Full name must be at most 100 characters"),
  studentNumber: z
    .string({ error: "Student ID must be a string" })
    .trim()
    .min(1, "Student ID is required")
    .max(32, "Student ID must be at most 32 characters")
    .regex(/^[A-Za-z0-9./-]+$/u, "Student ID can only contain letters, numbers, dots, slashes, and dashes"),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export const registrationSchema = registrationInputSchema.transform((input) => ({
  ...input,
  normalizedEmail: normalizeEmail(input.email),
}));

export const loginSchema = loginInputSchema.transform((input) => ({
  ...input,
  normalizedEmail: normalizeEmail(input.email),
}));

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthValidationResponse {
  error: typeof AUTH_VALIDATION_ERROR;
  errors: Record<string, string[]>;
}

export function formatAuthValidationErrors(
  error: z.ZodError,
): AuthValidationResponse {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "body";
    const message =
      issue.code === "unrecognized_keys"
        ? "Request contains unsupported fields"
        : issue.message;
    const messages = errors[field] ?? [];
    if (!messages.includes(message)) messages.push(message);
    errors[field] = messages;
  }

  return {
    error: AUTH_VALIDATION_ERROR,
    errors,
  };
}
