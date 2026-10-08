import { card, container } from "@/components/student/styles";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-sn-bg" aria-busy="true">
      <header className="border-b border-sn-border">
        <div className={`${container} flex items-center justify-between py-3.5`}>
          <div className="h-5 w-28 rounded bg-sn-border" />
          <div className="size-11 rounded-full bg-sn-border" />
        </div>
      </header>
      <main className={`${container} py-12`}>
        <div className="h-9 w-72 max-w-full rounded bg-sn-border" />
        <div className="mt-8 h-11 border-b border-sn-border" />
        <div className={`${card} mt-8 h-96`} />
        <div className="mt-7 grid gap-7 sm:grid-cols-2">
          <div className={`${card} h-52`} />
          <div className={`${card} h-52`} />
        </div>
      </main>
    </div>
  );
}
