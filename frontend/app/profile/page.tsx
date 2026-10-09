"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { signOut } from "@/lib/auth";
import { useSession } from "@/hooks/useSession";
import { queryKeys } from "@/lib/query-keys";
import { DASHBOARD_PAGE_SIZE, fetchDashboardStats } from "@/lib/dashboard-api";
import { fetchExaminerAssignments } from "@/lib/examiner-api";
import { fetchAdminStats } from "@/lib/admin-api";
import { readReduceMotion, writeReduceMotion } from "@/lib/preferences";
import type { SessionRole } from "@/types/auth";
import { BackLink, PageShell, PageState } from "@/components/student/PageShell";
import { initials } from "@/components/student/StudentNav";
import { IdentityForm } from "@/components/student/IdentityForm";
import { card, h2, h3, meta, primaryButton, secondaryButton } from "@/components/student/styles";

const roleLabels: Record<SessionRole, string> = {
  STUDENT: "Student",
  EXAMINER: "Examiner",
  ADMIN: "Admin",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const candidateNumber = (id: string) => `SN-${id.slice(0, 8).toUpperCase()}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-sn-border py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5">
      <dt className={meta}>{label}</dt>
      <dd className="m-0 min-w-0 tabular-nums [overflow-wrap:anywhere] sm:text-right">{children}</dd>
    </div>
  );
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const session = useSession({ required: true });
  const user = session.data;
  const dashboardParams = { limit: DASHBOARD_PAGE_SIZE };
  const dashboardQuery = useQuery({
    queryKey: queryKeys.studentDashboard(dashboardParams),
    queryFn: ({ signal }) => fetchDashboardStats(dashboardParams, signal),
    enabled: user?.role === "STUDENT",
  });
  const assignmentsQuery = useQuery({
    queryKey: queryKeys.examinerAssignments,
    queryFn: ({ signal }) => fetchExaminerAssignments(signal),
    enabled: user?.role === "EXAMINER",
  });
  const adminStatsQuery = useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: ({ signal }) => fetchAdminStats(signal),
    enabled: user?.role === "ADMIN",
  });

  // the checkbox only renders after the client-side session loads, so reading storage here is safe
  const [reduceMotion, setReduceMotion] = useState(() =>
    typeof window === "undefined" ? false : readReduceMotion(),
  );
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2400);
    return () => clearTimeout(t);
  }, [saved]);

  if (session.isPending) {
    return (
      <PageState>
        <Loader2 className="mx-auto size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
        <p className="mt-4 text-sm text-sn-muted">Opening your profile…</p>
      </PageState>
    );
  }

  if (session.isError || !user) {
    return (
      <PageState>
        <h1 className={h3}>Something went wrong</h1>
        <p className="mt-2 text-[15px] text-sn-muted">Failed to load your profile. Please try again.</p>
        <button type="button" className={`${primaryButton} mt-5 w-full`} onClick={() => window.location.reload()}>
          Try again
        </button>
      </PageState>
    );
  }

  const homeHref = user.role === "ADMIN" ? "/admin" : "/dashboard";
  const dashboard = dashboardQuery.data;
  const assignments = assignmentsQuery.data ?? [];
  const adminStats = adminStatsQuery.data;

  const glance: Array<[string, string]> =
    user.role === "STUDENT"
      ? [
          ["Tests taken", dashboard ? String(dashboard.totalTests) : "—"],
          [
            "Best band",
            dashboard?.bestScore
              ? dashboard.bestScore.scoringSystem === "RUBRIC_6"
                ? dashboard.bestScore.value.toFixed(2)
                : `${dashboard.bestScore.value}/100`
              : "—",
          ],
        ]
      : user.role === "EXAMINER"
        ? [
            ["Assigned submissions", String(assignments.length)],
            [
              "To score",
              String(assignments.filter((a) => a.status === "ASSIGNED" || a.status === "IN_PROGRESS").length),
            ],
          ]
        : [
            ["Users", adminStats ? String(Object.values(adminStats.usersByRole).reduce((s, n) => s + n, 0)) : "—"],
            ["Pending grading", adminStats ? String(adminStats.pendingGrading) : "—"],
          ];

  return (
    <PageShell
      name={user.name}
      email={user.email}
      label={roleLabels[user.role]}
      homeHref={homeHref}
      contentId="profile-content"
      skipLabel="Skip to profile content"
    >
      <div className="flex flex-col items-start gap-3">
        <BackLink href={homeHref}>{user.role === "ADMIN" ? "Back to admin panel" : "Back to dashboard"}</BackLink>
        <h1 className={h2}>Profile &amp; settings</h1>
      </div>

      <div className="mt-8 grid items-start gap-8 min-[921px]:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-7">
          <section className={card} aria-labelledby="details-title">
            <h2 id="details-title" className={h3}>Your details</h2>
            <p className="mt-2 text-[15px] text-sn-muted">
              These come from your sign-in account and can&apos;t be edited here yet.
            </p>
            <dl className="mt-3 mb-0">
              <Row label="Full name">{user.name}</Row>
              <Row label="Email">{user.email}</Row>
              <Row label="Role">{roleLabels[user.role]}</Row>
              <Row label="Candidate number">{candidateNumber(user.id)}</Row>
              <Row label="Member since">{formatDate(user.createdAt)}</Row>
            </dl>
          </section>

          {user.role === "STUDENT" && (
            <section className={card} aria-labelledby="identity-title">
              <h2 id="identity-title" className={h3}>Identity for the speaking test</h2>
              <p className="mt-2 mb-5 text-[15px] text-sn-muted">
                In the system check you say &ldquo;My name is [full name] and my Student ID is [number].&rdquo;
              </p>
              <IdentityForm user={user} />
            </section>
          )}

          <section className={card} aria-labelledby="prefs-title">
            <h2 id="prefs-title" className={h3}>Preferences</h2>
            <p className="mt-3 min-h-[1.55em] text-sm text-sn-muted" role="status">
              {saved ? "Saved." : ""}
            </p>
            <div className="flex items-center gap-5 pt-2">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <label htmlFor="pref-motion" className="text-[15px] font-semibold">Reduce motion</label>
                <p id="pref-motion-help" className="m-0 text-sm text-sn-muted">
                  Turns off button and menu animation. Saved in this browser only.
                </p>
              </div>
              <span className="grid size-11 shrink-0 place-items-center">
                <input
                  id="pref-motion"
                  type="checkbox"
                  className="size-[22px] cursor-pointer accent-sn-fg"
                  aria-describedby="pref-motion-help"
                  checked={reduceMotion}
                  onChange={(e) => {
                    setReduceMotion(e.target.checked);
                    writeReduceMotion(e.target.checked);
                    setSaved(true);
                  }}
                />
              </span>
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-7">
          <section className={card} aria-label="Account summary">
            <div className="flex flex-col items-start gap-3">
              <div
                className="grid size-20 place-items-center rounded-full bg-sn-field-navy text-[28px] font-semibold text-sn-navy"
                aria-hidden="true"
              >
                {initials(user.name)}
              </div>
              <div className="grid min-w-0 gap-0.5">
                <span className="text-xl font-semibold leading-[1.3] [overflow-wrap:anywhere]">{user.name}</span>
                <span className="text-[15px] text-sn-muted [overflow-wrap:anywhere]">{user.email}</span>
              </div>
            </div>
            <dl className="mt-5 mb-0">
              {glance.map(([label, value]) => (
                <Row key={label} label={label}>{value}</Row>
              ))}
            </dl>
          </section>

          <section className={card} aria-labelledby="account-title">
            <h2 id="account-title" className={h3}>Account</h2>
            <p className="mt-2 text-[15px] text-sn-muted">
              Signing out ends this session on this device. Your results stay in your account.
            </p>
            <div className="mt-5">
              <button type="button" className={secondaryButton} onClick={() => void signOut(queryClient)}>
                Sign out
              </button>
            </div>
          </section>
        </aside>
      </div>
    </PageShell>
  );
}
