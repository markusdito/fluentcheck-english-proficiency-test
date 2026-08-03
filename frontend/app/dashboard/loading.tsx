export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="size-8 bg-ink" />
            <div className="h-3.5 w-32 bg-rule" />
          </div>
          <div className="size-8 rounded-full bg-rule" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="h-10 w-64 bg-rule/80" />
        <div className="mt-3 h-3.5 w-96 max-w-full bg-rule/50" />

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="h-28 border border-rule bg-paper-raised" />
          <div className="h-28 border border-rule bg-paper-raised" />
        </div>

        <div className="mt-6 h-36 border border-ink bg-ink/[0.04]" />

        <div className="mt-12 h-5 w-36 bg-rule/80" />
        <div className="mt-6 h-64 border border-rule bg-paper-raised" />
      </main>
    </div>
  );
}
