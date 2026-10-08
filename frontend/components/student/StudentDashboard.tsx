"use client";

import { Tabs } from "@base-ui/react/tabs";
import type { DashboardStats } from "@/lib/dashboard-api";
import { PageShell } from "./PageShell";
import { StartCard } from "./StartCard";
import { LatestResultCard, RecentCard, ResultRow } from "./ResultCards";
import { card, focusRing, h2, h3, meta, secondaryButton } from "./styles";

interface StudentDashboardProps {
  name: string;
  email: string;
  dashboard: DashboardStats | undefined;
  page: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onStart: () => void;
}

const tab = `-mb-px min-h-11 cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0.5 py-3 text-[15px] font-medium text-sn-muted transition-colors duration-200 hover:text-sn-fg data-active:border-sn-fg data-active:text-sn-fg ${focusRing}`;

export function StudentDashboard({
  name,
  email,
  dashboard,
  page,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onStart,
}: StudentDashboardProps) {
  const subs = dashboard?.submissions ?? [];
  const latestScored = subs.find((s) => s.score != null);
  const first = name.trim().split(/\s+/)[0];

  return (
    <PageShell name={name} email={email} contentId="dashboard-content" skipLabel="Skip to dashboard content">
      <h1 className={h2}>Welcome back{first ? `, ${first}` : ""}</h1>

      <Tabs.Root defaultValue="overview">
        <Tabs.List aria-label="Student sections" className="mt-8 flex gap-8 border-b border-sn-border">
          <Tabs.Tab value="overview" className={tab}>Overview</Tabs.Tab>
          <Tabs.Tab value="results" className={tab}>Results</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" className="flex flex-col gap-7 pt-8 outline-none">
          <StartCard onStart={onStart} />
          <div className="grid items-stretch gap-7 sm:grid-cols-2">
            <LatestResultCard sub={latestScored} />
            <RecentCard subs={subs.slice(0, 3)} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="results" className="pt-8 outline-none">
          <article className={card}>
            <div className="flex flex-wrap items-center justify-between gap-5">
              <h2 className={h3}>All results</h2>
              <p className={meta}>
                {dashboard?.totalTests ?? 0} assessment{dashboard?.totalTests === 1 ? "" : "s"}
              </p>
            </div>
            {subs.length ? (
              <ul role="list" className="mt-3 list-none p-0">
                {subs.map((sub) => (
                  <li key={sub.id} className="border-t border-sn-border">
                    <ResultRow sub={sub} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[15px] text-sn-muted">No assessments yet. Start the speaking test from Overview.</p>
            )}
            {(canPrev || canNext) && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="m-0 text-sm text-sn-muted" aria-live="polite">Page {page}</p>
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} aria-label="Previous history page" disabled={!canPrev} onClick={onPrev}>
                    Previous
                  </button>
                  <button type="button" className={secondaryButton} aria-label="Next history page" disabled={!canNext} onClick={onNext}>
                    Next
                  </button>
                </div>
              </div>
            )}
            <p className={`${meta} mt-3`}>Abandoned sessions have no report</p>
          </article>
        </Tabs.Panel>
      </Tabs.Root>
    </PageShell>
  );
}
