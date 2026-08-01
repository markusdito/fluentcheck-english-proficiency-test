"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  fetchAdminUsers,
  updateUserRole,
} from "@/lib/admin-api";
import type { AdminUser } from "@/types/admin";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

const ROLE_OPTIONS = ["STUDENT", "EXAMINER", "ADMIN"];

interface CurrentUser {
  id: string;
}

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AdminUser[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentAdminId, setCurrentAdminId] = useState("");
  const [roleError, setRoleError] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ status: string; data: { user: CurrentUser } }>(
          "/auth/me"
        );
        if (!cancelled) {
          setCurrentAdminId(res.data.user.id);
        }
      } catch {
        // Layout already gates ADMIN; best-effort to identify the current admin.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminUsers({
        page,
        role: roleFilter === "ALL" ? undefined : roleFilter,
        q: query || undefined,
      });
      setItems(data.items);
      setTotalPages(data.totalPages);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        window.location.href = "/login";
        return;
      }
      setError("Failed to load users. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRoleChange(user: AdminUser, role: string) {
    setRoleError((prev) => ({ ...prev, [user.id]: "" }));
    try {
      await updateUserRole(user.id, role);
      setItems((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, role } : u))
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
        <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
          Users
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage user accounts and roles.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <form onSubmit={handleSearch} className="flex w-full max-w-sm items-end gap-2">
          <Input
            label="Search"
            placeholder="Username or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
        <div className="w-full max-w-xs">
          <label
            htmlFor="role-filter"
            className="mb-1.5 block text-sm font-medium text-[var(--foreground)]"
          >
            Role
          </label>
          <select
            id="role-filter"
            value={roleFilter}
            onChange={(e) => handleRoleFilterChange(e.target.value)}
            className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--foreground)] transition-colors outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)]"
          >
            <option value="ALL">All</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
          <h3 className="text-base font-medium text-[var(--foreground)]">
            No users found
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Try adjusting your search or filters.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-white shadow-sm">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {items.map((user) => {
                  const isSelf = user.id === currentAdminId;
                  return (
                    <tr key={user.id}>
                      <td className="px-6 py-4 text-sm font-medium text-[var(--foreground)]">
                        {user.username}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--muted)]">
                        {user.email}
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={user.role}
                          disabled={isSelf}
                          onChange={(e) => handleRoleChange(user, e.target.value)}
                          className="block w-full max-w-[9rem] rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--foreground)] transition-colors outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        {roleError[user.id] && (
                          <p className="mt-1.5 text-xs text-[var(--danger)]">
                            {roleError[user.id]}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--muted)]">
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

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">
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
