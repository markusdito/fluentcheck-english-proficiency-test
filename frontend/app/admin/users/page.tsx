"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { ApiError } from "@/lib/api";
import {
  fetchAdminUsers,
  fetchRoleTransitionPreview,
  updateUserRole,
} from "@/lib/admin-api";
import type {
  AccountTransitionPreview,
  AdminUser,
  Paginated,
} from "@/types/admin";
import { queryKeys } from "@/lib/query-keys";
import { Loader2 } from "lucide-react";
import { card, h2, h3, meta, primaryButton, secondaryButton } from "@/components/student/styles";
import { empty, error as errorText, field, label, lead, tableWrap, td, th, tr } from "@/components/admin/styles";

const ROLE_OPTIONS = ["STUDENT", "EXAMINER", "ADMIN"];
const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

function removesExaminerCapability(currentRole: string, requestedRole: string) {
  return (
    requestedRole === "STUDENT" &&
    (currentRole === "EXAMINER" || currentRole === "ADMIN")
  );
}

function roleTransitionErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "Failed to update role. Please try again.";
  }
  switch (error.code) {
    case "LAST_ACTIVE_ADMIN":
      return "Keep at least one active administrator.";
    case "EXAMINER_ASSIGNMENTS_IN_PROGRESS":
      return "Finish in-progress Examiner work before removing this capability.";
    case "EXAMINER_HAS_OPEN_ASSIGNMENTS":
      return "Assignments with saved scores cannot be transferred.";
    case "INVALID_REASSIGNMENT":
      return "Choose one distinct active Examiner for every transferable assignment.";
    case "REASSIGNMENT_CONFLICT":
      return "The account changed while you were reviewing it. Refresh and try again.";
    default:
      return error.message;
  }
}

function canApplyTransition(
  preview: AccountTransitionPreview,
  reassignmentMap: Record<string, string>,
) {
  if (
    preview.assignments.some(
      (assignment) =>
        assignment.status === "IN_PROGRESS" || assignment.scoreCount > 0,
    )
  ) {
    return false;
  }
  const transferable = preview.assignments.filter(
    (assignment) => assignment.transferEligible,
  );
  if (!transferable.every((assignment) => reassignmentMap[assignment.id])) {
    return false;
  }
  return new Set(transferable.map((assignment) => reassignmentMap[assignment.id])).size === transferable.length;
}

function TransitionImpactPanel({
  preview,
  reassignmentMap,
  onReplacementChange,
  transitionError,
}: {
  preview: AccountTransitionPreview;
  reassignmentMap: Record<string, string>;
  onReplacementChange: (assignmentId: string, replacementId: string) => void;
  transitionError: string;
}) {
  if (preview.assignments.length === 0) {
    return (
      <p className="mt-5 rounded-xl border border-dashed border-sn-border px-4 py-3 text-sm text-sn-muted">
        No open Examiner assignments need reassignment.
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      {preview.assignments.map((assignment) => (
        <div
          key={assignment.id}
          className="rounded-xl border border-sn-border px-4 py-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={meta}>
                Slot {assignment.slot} · {assignment.status}
              </p>
              <p className="mt-1 text-sm text-sn-fg">
                Current owner: {assignment.currentExaminer.username}
              </p>
              <p className="mt-1 text-xs text-sn-muted">
                Assignment {assignment.id} · Submission {assignment.submissionId}
              </p>
              <p className="mt-1 text-xs text-sn-muted">
                {assignment.transferEligible ? "Transfer eligible" : "Transfer blocked"} · {assignment.scoreCount} saved score{assignment.scoreCount === 1 ? "" : "s"}
              </p>
            </div>
            {assignment.status === "IN_PROGRESS" ? (
              <p className="text-sm text-sn-clay">
                Finish this assignment before changing the role.
              </p>
            ) : assignment.scoreCount > 0 ? (
              <p className="text-sm text-sn-clay">
                Saved-score assignments cannot be transferred.
              </p>
            ) : assignment.transferEligible ? (
              <div className="w-full sm:max-w-xs">
                <label className={label}>
                  Replacement Examiner
                  <select
                    className={field}
                    value={reassignmentMap[assignment.id] ?? ""}
                    onChange={(e) => onReplacementChange(assignment.id, e.target.value)}
                    aria-label={`Replacement for assignment ${assignment.id}`}
                  >
                    <option value="" disabled>Choose an active Examiner</option>
                    {assignment.candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.username} · {candidate.email}
                      </option>
                    ))}
                  </select>
                </label>
                {assignment.candidates.length === 0 && (
                  <p className="mt-1.5 text-[13px] text-sn-clay">
                    No eligible replacement Examiner is available.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {transitionError && <p className="text-sm text-sn-clay">{transitionError}</p>}
    </div>
  );
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const session = useSession({ required: true });
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [roleError, setRoleError] = useState<Record<string, string>>({});
  const [roleSuccess, setRoleSuccess] = useState<Record<string, string>>({});
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<{
    user: AdminUser;
    role: string;
  } | null>(null);
  const [reassignmentMap, setReassignmentMap] = useState<Record<string, string>>({});
  const [transitionError, setTransitionError] = useState("");
  const params = {
    page,
    role: roleFilter === "ALL" ? undefined : roleFilter,
    q: query || undefined,
  };
  const usersKey = queryKeys.adminUsers(params);
  const usersQuery = useQuery({
    queryKey: usersKey,
    queryFn: ({ signal }) => fetchAdminUsers(params, signal),
    enabled: session.data?.role === "ADMIN",
  });
  const items = usersQuery.data?.items ?? [];
  const totalPages = usersQuery.data?.totalPages ?? 1;
  const currentAdminId = session.data?.id ?? "";
  const previewKey = pendingTransition
    ? queryKeys.roleTransitionPreview(pendingTransition.user.id, pendingTransition.role)
    : queryKeys.roleTransitionPreview("none", "none");
  const rolePreviewQuery = useQuery<AccountTransitionPreview>({
    queryKey: previewKey,
    queryFn: ({ signal }) => {
      if (!pendingTransition) throw new Error("No pending role transition");
      return fetchRoleTransitionPreview(
        pendingTransition.user.id,
        pendingTransition.role,
        signal,
      );
    },
    enabled: session.data?.role === "ADMIN" && pendingTransition !== null,
  });

  async function applyRoleChange(
    user: AdminUser,
    role: string,
    map?: Record<string, string>,
  ) {
    setRoleError((prev) => ({ ...prev, [user.id]: "" }));
    setTransitionError("");
    setRoleBusy(user.id);
    try {
      const result = await updateUserRole(user.id, role, map);
      queryClient.setQueryData<Paginated<AdminUser>>(usersKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === user.id ? { ...item, role: result.user.role } : item,
              ),
            }
          : current,
      );
      setRoleSuccess((prev) => ({
        ...prev,
        [user.id]:
          result.outcome === "ALREADY_APPLIED"
            ? "Already applied."
            : "Role updated.",
      }));
      setPendingTransition(null);
      setReassignmentMap({});
    } catch (err) {
      const message = roleTransitionErrorMessage(err);
      setRoleError((prev) => ({
        ...prev,
        [user.id]: message,
      }));
      setTransitionError(message);
    } finally {
      setRoleBusy(null);
    }
  }

  function handleRoleChange(user: AdminUser, role: string) {
    if (role === user.role) return;
    setRoleSuccess((prev) => ({ ...prev, [user.id]: "" }));
    setRoleError((prev) => ({ ...prev, [user.id]: "" }));
    setTransitionError("");
    if (removesExaminerCapability(user.role, role)) {
      setPendingTransition({ user, role });
      setReassignmentMap({});
      return;
    }
    void applyRoleChange(user, role);
  }

  function cancelPendingTransition() {
    if (pendingTransition) {
      setRoleError((prev) => ({ ...prev, [pendingTransition.user.id]: "" }));
    }
    setPendingTransition(null);
    setReassignmentMap({});
    setTransitionError("");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(q);
  }

  function handleRoleFilterChange(role: string) {
    setRoleFilter(role);
    setPage(1);
  }

  return (
    <div>
      <h1 className={h2}>Users</h1>
      <p className={lead}>Manage user accounts and roles.</p>

      <div className="mt-10 mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <form onSubmit={handleSearch} className="flex w-full max-w-md items-end gap-2">
          <label className={`${label} flex-1`}>
            Search
            <input
              type="search"
              className={field}
              placeholder="Username or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button type="submit" className={`${secondaryButton} max-sm:w-auto`}>
            Search
          </button>
        </form>
        <label className={`${label} w-full max-w-xs`}>
          Role
          <select className={field} value={roleFilter} onChange={(e) => handleRoleFilterChange(e.target.value)}>
            <option value="ALL">All</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{roleLabel(role)}</option>
            ))}
          </select>
        </label>
      </div>

      {pendingTransition && (
        <div className={`${card} mb-6`} role="dialog" aria-label="Review account transition">
          <h2 className={h3}>Remove Examiner access from {pendingTransition.user.username}?</h2>
          <p className="mt-2 text-[15px] text-sn-muted">
            Existing assigned work stays on the same submission and slot. Choose a distinct active Examiner for every transferable assignment.
          </p>

          {rolePreviewQuery.isPending ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-sn-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading assignment impact…
            </div>
          ) : rolePreviewQuery.isError ? (
            <p className={`${errorText} mt-5`}>
              {roleTransitionErrorMessage(rolePreviewQuery.error)}
            </p>
          ) : rolePreviewQuery.data ? (
            <TransitionImpactPanel
              preview={rolePreviewQuery.data}
              reassignmentMap={reassignmentMap}
              onReplacementChange={(assignmentId, replacementId) =>
                setReassignmentMap((current) => ({
                  ...current,
                  [assignmentId]: replacementId,
                }))
              }
              transitionError={transitionError}
            />
          ) : null}

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" className={secondaryButton} onClick={cancelPendingTransition} disabled={roleBusy !== null}>
              Cancel
            </button>
            <button
              type="button"
              className={primaryButton}
              onClick={() =>
                pendingTransition &&
                void applyRoleChange(
                  pendingTransition.user,
                  pendingTransition.role,
                  reassignmentMap,
                )
              }
              aria-busy={roleBusy === pendingTransition.user.id || undefined}
              disabled={
                roleBusy !== null ||
                rolePreviewQuery.isPending ||
                rolePreviewQuery.isError ||
                !rolePreviewQuery.data ||
                !canApplyTransition(rolePreviewQuery.data, reassignmentMap)
              }
            >
              {roleBusy === pendingTransition.user.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Apply role change
            </button>
          </div>
        </div>
      )}

      {usersQuery.isError ? (
        <p className={empty}>Failed to load users. Please try again.</p>
      ) : usersQuery.isPending ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <p className={empty}>No users found. Try adjusting your search or filters.</p>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full border-collapse">
              <caption className="sr-only">Users</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Username</th>
                  <th scope="col" className={th}>Email</th>
                  <th scope="col" className={th}>Role</th>
                  <th scope="col" className={th}>State</th>
                  <th scope="col" className={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((user) => {
                  const isSelf = user.id === currentAdminId;
                  const isDeactivated = user.deletedAt != null;
                  const selectedRole =
                    pendingTransition?.user.id === user.id
                      ? pendingTransition.role
                      : user.role;
                  return (
                    <tr key={user.id} className={tr}>
                      <td className={`${td} font-medium`}>{user.username}</td>
                      <td className={`${td} text-sn-muted`}>{user.email}</td>
                      <td className={td}>
                        <select
                          className={`${field} w-36`}
                          aria-label={`Role for ${user.username}`}
                          value={selectedRole}
                          onChange={(e) => handleRoleChange(user, e.target.value)}
                          disabled={isSelf || isDeactivated || roleBusy !== null}
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>{roleLabel(role)}</option>
                          ))}
                        </select>
                        {roleError[user.id] && (
                          <p className="mt-1.5 text-[13px] text-sn-clay">{roleError[user.id]}</p>
                        )}
                        {roleSuccess[user.id] && (
                          <p className="mt-1.5 text-[13px] text-sn-muted">{roleSuccess[user.id]}</p>
                        )}
                      </td>
                      <td className={`${td} text-sn-muted`}>{isDeactivated ? "Deactivated" : "Active"}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums text-sn-muted`}>
                        {new Date(user.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <p className={meta}>Page {page} of {Math.max(totalPages, 1)}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`${secondaryButton} max-sm:w-auto`}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className={`${secondaryButton} max-sm:w-auto`}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
