"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  fetchAdminSettings,
  updateAdminSettings,
} from "@/lib/admin-api";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: queryKeys.adminSettings,
    queryFn: ({ signal }) => fetchAdminSettings(signal),
    staleTime: 0,
  });
  const settings = settingsQuery.data;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handlePaymentToggle() {
    if (!settings || saving) return;

    const previous = settings;
    const paymentEnabled = !settings.paymentEnabled;
    queryClient.setQueryData(queryKeys.adminSettings, {
      ...settings,
      paymentEnabled,
    });
    setSaving(true);
    setError("");

    try {
      const updated = await updateAdminSettings(paymentEnabled);
      queryClient.setQueryData(queryKeys.adminSettings, updated);
    } catch {
      queryClient.setQueryData(queryKeys.adminSettings, previous);
      setError("The payment setting could not be saved. No changes were applied.");
    } finally {
      setSaving(false);
    }
  }

  if (settingsQuery.isPending) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2
          className="size-8 animate-spin text-ink-faint"
          role="status"
          aria-label="Loading settings"
        />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-ink-soft" role="alert">
          {error || "Failed to load settings. Please try again."}
        </p>
        <Button className="ml-4" onClick={() => settingsQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <p className="mark">Platform controls</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
          Control how completed tests enter the review workflow.
        </p>
      </div>

      <section
        aria-labelledby="payment-settings-heading"
        className="border border-rule bg-paper-raised"
      >
        <div className="border-b border-rule px-5 py-4 sm:px-6">
          <p className="mark">Payments</p>
          <h2
            id="payment-settings-heading"
            className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink"
          >
            Payment requirement
          </h2>
        </div>

        <div className="grid gap-5 px-5 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
          <div>
            <p className="text-sm font-semibold text-ink">
              Require payment before scoring
            </p>
            <p
              id="payment-setting-description"
              className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-soft"
            >
              {settings.paymentEnabled
                ? "Completed tests wait for payment confirmation before examiners are assigned."
                : "Payment is waived for newly completed tests and examiners are assigned automatically."}
            </p>
            <p
              className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint"
              aria-live="polite"
            >
              {saving
                ? "Saving change…"
                : `Last updated ${formatUpdatedAt(settings.updatedAt)}`}
            </p>
          </div>

          <div className="flex items-center gap-3 sm:justify-end">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
              {settings.paymentEnabled ? "On" : "Off"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.paymentEnabled}
              aria-describedby="payment-setting-description"
              aria-label="Require payment before scoring"
              disabled={saving}
              onClick={handlePaymentToggle}
              className={cn(
                "relative inline-flex h-7 w-12 shrink-0 items-center border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-wait disabled:opacity-60",
                settings.paymentEnabled
                  ? "border-ink bg-ink"
                  : "border-rule-strong bg-paper",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block size-5 border transition-transform",
                  settings.paymentEnabled
                    ? "translate-x-6 border-paper bg-paper"
                    : "translate-x-1 border-ink bg-ink",
                )}
              />
            </button>
          </div>
        </div>

        {error && (
          <div className="border-t border-rule px-5 py-3 sm:px-6" role="alert">
            <p className="text-sm text-signal">{error}</p>
          </div>
        )}
      </section>
    </div>
  );
}
