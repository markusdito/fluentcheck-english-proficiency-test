"use client";

import Link from "next/link";
import type { ExaminerAssignmentSummary } from "@/types/examiner";
import { AssignmentPill, submissionRef } from "@/components/examiner/ExaminerDashboard";
import { secondaryButton } from "@/components/student/styles";
import { empty, tableWrap, td, th, tr } from "@/components/admin/styles";

export function AssignmentList({ assignments }: { assignments: ExaminerAssignmentSummary[] }) {
  if (assignments.length === 0) {
    return <p className={empty}>Submissions assigned to you for scoring will appear here.</p>;
  }

  return (
    <div className={tableWrap}>
      <table className="w-full border-collapse">
        <caption className="sr-only">Your assignments</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>Submission</th>
            <th scope="col" className={th}>Candidate</th>
                  <th scope="col" className={th}>Test Set</th>
            <th scope="col" className={th}>Assigned</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={th}><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id} className={tr}>
              <td className={`${td} font-medium whitespace-nowrap tabular-nums`}>{submissionRef(a.submissionId)}</td>
              <td className={`${td} max-w-[24ch] truncate`}>{a.studentName}</td>
                    <td className={`${td} whitespace-nowrap text-sn-muted`}>{a.testSet?.code ?? "—"}</td>
              <td className={`${td} whitespace-nowrap tabular-nums text-sn-muted`}>
                {new Date(a.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
              </td>
              <td className={td}><AssignmentPill a={a} /></td>
              <td className={`${td} text-right`}>
                <Link href={`/examiner/assignments/${a.id}`} className={`${secondaryButton} max-sm:w-auto`}>
                  {a.status === "COMPLETED" ? "View" : "Open"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
