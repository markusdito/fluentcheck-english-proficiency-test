interface StatusBadgeProps {
  label: string;
  tone?: "amber" | "blue" | "emerald" | "zinc";
  className?: string;
}

const toneClasses: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  emerald: "bg-emerald-50 text-emerald-700",
  zinc: "bg-zinc-100 text-zinc-600",
};

export function StatusBadge({ label, tone = "zinc", className }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]} ${className ?? ""}`}
    >
      {label}
    </span>
  );
}
