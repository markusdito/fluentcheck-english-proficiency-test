"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  fetchAdminSettings,
  updateAdminSettings,
} from "@/lib/admin-api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/cn";
import { card, focusRing, h2, h3, meta, primaryButton } from "@/components/student/styles";
import { error as errorText, lead } from "@/components/admin/styles";

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
        <Loader2 className="size-8 animate-spin text-sn-muted" role="status" aria-label="Loading settings" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-[15px] text-sn-muted" role="alert">
          {error || "Failed to load settings. Please try again."}
        </p>
        <button type="button" className={`${primaryButton} mt-5`} onClick={() => settingsQuery.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className={h2}>Settings</h1>
      <p className={lead}>Control how completed tests enter the review workflow.</p>

      <section aria-labelledby="payment-settings-heading" className={`${card} mt-10 max-w-[760px]`}>
        <h2 id="payment-settings-heading" className={h3}>Payment requirement</h2>
        <div className="mt-5 flex items-center gap-5 border-t border-sn-border pt-5">
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="m-0 text-[15px] font-semibold">Require payment before scoring</p>
            <p id="payment-setting-description" className="m-0 text-sm text-sn-muted">
              {settings.paymentEnabled
                ? "Completed tests wait for payment confirmation before examiners are assigned."
                : "Payment is waived for newly completed tests and examiners are assigned automatically."}
            </p>
            <p className={`${meta} mt-2`} aria-live="polite">
              {saving ? "Saving change…" : `Last updated ${formatUpdatedAt(settings.updatedAt)}`}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.paymentEnabled}
            aria-describedby="payment-setting-description"
            aria-label="Require payment before scoring"
            disabled={saving}
            onClick={handlePaymentToggle}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 disabled:cursor-wait disabled:opacity-60",
              focusRing,
              settings.paymentEnabled ? "border-sn-fg bg-sn-fg" : "border-sn-border bg-sn-border",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "block size-5 rounded-full bg-sn-surface shadow-sm transition-transform duration-200 ease-spring",
                settings.paymentEnabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
        {error && (
          <p className={`${errorText} mt-4`} role="alert">{error}</p>
        )}
      </section>
    </div>
  );
}
