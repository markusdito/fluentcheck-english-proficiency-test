"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { ApiError } from "@/lib/api";
import {
  fetchAdminUsers,
  updateUserRole,
} from "@/lib/admin-api";
import type { AdminUser, Paginated } from "@/types/admin";
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

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const session = useSession({ required: true });
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [roleError, setRoleError] = useState<Record<string, string>>({});
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

  async function handleRoleChange(user: AdminUser, role: string) {
    setRoleError((prev) => ({ ...prev, [user.id]: "" }));
    try {
      await updateUserRole(user.id, role);
      queryClient.setQueryData<Paginated<AdminUser>>(usersKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === user.id ? { ...item, role } : item,
              ),
            }
          : current,
      );
    } catch (err) {
      setRoleError((prev) => ({
        ...prev,
        [user.id]:
          err instanceof ApiError
            ? err.message
            : "Failed to update role. Please try again.",
      }));
    }
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
                          value={user.role}
                          onValueChange={(role) =>
                            role != null && handleRoleChange(user, role)
                          }
                          disabled={isSelf}
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
