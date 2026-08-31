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
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Loader2, SearchIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ROLE_OPTIONS = ["STUDENT", "EXAMINER", "ADMIN"];

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
      <p className="mt-5 border border-dashed border-rule px-4 py-3 text-sm text-ink-soft">
        No open Examiner assignments need reassignment.
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      {preview.assignments.map((assignment) => (
        <div
          key={assignment.id}
          className="border border-rule px-4 py-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                Slot {assignment.slot} · {assignment.status}
              </p>
              <p className="mt-1 text-sm text-ink">
                Current owner: {assignment.currentExaminer.username}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                Assignment {assignment.id} · {assignment.scoreCount} saved score{assignment.scoreCount === 1 ? "" : "s"}
              </p>
            </div>
            {assignment.status === "IN_PROGRESS" ? (
              <p className="text-sm text-signal">
                Finish this assignment before changing the role.
              </p>
            ) : assignment.scoreCount > 0 ? (
              <p className="text-sm text-signal">
                Saved-score assignments cannot be transferred.
              </p>
            ) : assignment.transferEligible ? (
              <div className="w-full sm:max-w-xs">
                <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                  Replacement Examiner
                </p>
                <Select
                  value={reassignmentMap[assignment.id] || undefined}
                  onValueChange={(replacementId) =>
                    replacementId != null &&
                    onReplacementChange(assignment.id, replacementId)
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    aria-label={`Replacement for assignment ${assignment.id}`}
                  >
                    <SelectValue placeholder="Choose an active Examiner" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignment.candidates.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.username} · {candidate.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {assignment.candidates.length === 0 && (
                  <p className="mt-1.5 text-xs text-signal">
                    No eligible replacement Examiner is available.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {transitionError && <p className="text-sm text-signal">{transitionError}</p>}
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
      <div className="mb-8">
        <p className="mark">People</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
          Users
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Manage user accounts and roles.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <form onSubmit={handleSearch} className="flex w-full max-w-sm items-end gap-2">
          <FormField
            label="Search"
            placeholder="Username or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            icon={<SearchIcon className="size-4" />}
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
        <div className="w-full max-w-xs">
          <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Role
          </p>
          <Select value={roleFilter} onValueChange={(role) => role != null && handleRoleFilterChange(role)}>
            <SelectTrigger size="default" className="w-full">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              {ROLE_OPTIONS.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pendingTransition && (
        <div className="mb-6 border border-rule-strong bg-paper-raised p-5" role="dialog" aria-label="Review account transition">
          <div className="flex flex-col gap-1">
            <p className="mark text-xs">Review transition</p>
            <h2 className="font-display text-xl font-medium text-ink">
              Remove Examiner access from {pendingTransition.user.username}?
            </h2>
            <p className="text-sm leading-6 text-ink-soft">
              Existing assigned work stays on the same submission and slot. Choose a distinct active Examiner for every transferable assignment.
            </p>
          </div>

          {rolePreviewQuery.isPending ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading assignment impact…
            </div>
          ) : rolePreviewQuery.isError ? (
            <p className="mt-5 text-sm text-signal">
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

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={cancelPendingTransition} disabled={roleBusy !== null}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                pendingTransition &&
                void applyRoleChange(
                  pendingTransition.user,
                  pendingTransition.role,
                  reassignmentMap,
                )
              }
              loading={roleBusy === pendingTransition.user.id}
              disabled={
                rolePreviewQuery.isPending ||
                rolePreviewQuery.isError ||
                !rolePreviewQuery.data ||
                !canApplyTransition(rolePreviewQuery.data, reassignmentMap)
              }
            >
              Apply role change
            </Button>
          </div>
        </div>
      )}

      {usersQuery.isError ? (
        <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-12 text-center">
          <p className="text-sm text-ink-soft">
            Failed to load users. Please try again.
          </p>
        </div>
      ) : usersQuery.isPending ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-12 text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            No users found
          </p>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">
            Try adjusting your search or filters.
          </p>
        </div>
      ) : (
        <>
          <div className="border border-rule bg-paper-raised">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="mark px-5 text-xs font-semibold">
                    Username
                  </TableHead>
                  <TableHead className="mark px-5 text-xs font-semibold">
                    Email
                  </TableHead>
                  <TableHead className="mark px-5 text-xs font-semibold">
                    Role
                  </TableHead>
                  <TableHead className="mark px-5 text-xs font-semibold">
                    Created
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((user) => {
                  const isSelf = user.id === currentAdminId;
                  const selectedRole =
                    pendingTransition?.user.id === user.id
                      ? pendingTransition.role
                      : user.role;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="px-5 py-3.5 text-sm font-medium text-ink">
                        {user.username}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-ink-soft">
                        {user.email}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <Select
                          value={selectedRole}
                          onValueChange={(role) =>
                            role != null && handleRoleChange(user, role)
                          }
                          disabled={isSelf || roleBusy !== null}
                        >
                          <SelectTrigger size="sm" className="w-full max-w-36">
                            <SelectValue placeholder="Role" />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {roleError[user.id] && (
                          <p className="mt-1.5 text-xs text-signal">
                            {roleError[user.id]}
                          </p>
                        )}
                        {roleSuccess[user.id] && (
                          <p className="mt-1.5 text-xs text-ink-soft">
                            {roleSuccess[user.id]}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-ink-soft">
                        {new Date(user.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-ink-soft">
              Page {page} of {Math.max(totalPages, 1)}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
