/**
 * Re-export of the shadcn `cn` helper (clsx + tailwind-merge).
 * Existing components import { cn } from "@/lib/cn"; this keeps them working
 * while adopting tailwind-merge deduping. Canonical source: "@/lib/utils".
 */
export { cn } from "@/lib/utils";
