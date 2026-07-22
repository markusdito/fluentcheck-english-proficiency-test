/**
 * Tiny className combiner — filters falsy values and joins with spaces.
 * No external dependency required.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
