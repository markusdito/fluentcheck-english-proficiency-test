export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="flex flex-col items-center gap-4">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]"
          role="status"
          aria-label="Loading"
        />
        <p className="text-sm text-[var(--muted)]">Loading your dashboard…</p>
      </div>
    </div>
  );
}