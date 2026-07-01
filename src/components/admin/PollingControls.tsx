import { type ReactNode } from "react";
import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  PAYMENTS_POLLING_OPTIONS,
  normalizePollingInterval,
  setUiPrefs,
  useUiPrefs,
} from "@/lib/ui-prefs";

/**
 * Shared refetch-interval resolver for admin ledger/list pages.
 *
 * Semantics match the payments page (source of truth for polling fallback):
 * - `paymentsPollingMs === 0` => background polling is off (returns `false`).
 * - `liveConnected` => cap the fallback at 120s so realtime does the heavy lifting.
 * - otherwise => honor the admin's chosen interval.
 *
 * Called from component bodies, so it re-runs when the pref changes and
 * TanStack Query picks up the new value on the next render.
 */
export function useListRefetchInterval(liveConnected = false): number | false {
  const { paymentsPollingMs } = useUiPrefs();
  if (paymentsPollingMs === 0) return false;
  if (liveConnected) return Math.max(paymentsPollingMs, 120_000);
  return paymentsPollingMs;
}

type PollingControlsProps = {
  /** Pass `true` from pages that have a realtime channel wired up. */
  liveConnected?: boolean;
  /** Optional extra badge/content rendered to the right of the selector. */
  rightSlot?: ReactNode;
  /** Hide the status badge when the page shows its own realtime indicator. */
  showStatusBadge?: boolean;
  /** Optional aria-label override for the select. */
  ariaLabel?: string;
};

/**
 * Header controls for admin list pages: Live/Polling/Manual badge plus the
 * cross-device polling-fallback selector. Wired to the single
 * `paymentsPollingMs` preference so changing it anywhere updates every page.
 */
export function PollingControls({
  liveConnected = false,
  rightSlot,
  showStatusBadge = true,
  ariaLabel = "Background refresh interval",
}: PollingControlsProps) {
  const { paymentsPollingMs } = useUiPrefs();

  const badgeTitle = liveConnected
    ? "Realtime updates connected"
    : paymentsPollingMs === 0
      ? "Realtime disconnected — background polling is off"
      : `Realtime disconnected — polling every ${Math.round(paymentsPollingMs / 1000)}s`;

  const badgeLabel = liveConnected
    ? "Live"
    : paymentsPollingMs === 0
      ? "Manual"
      : "Polling";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showStatusBadge && (
        <Badge
          variant="outline"
          className="gap-1.5 text-[10px] uppercase tracking-wider"
          title={badgeTitle}
        >
          <Radio
            className={`h-3 w-3 ${
              liveConnected ? "text-emerald-500 animate-pulse" : "text-muted-foreground"
            }`}
          />
          {badgeLabel}
        </Badge>
      )}
      {rightSlot}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="hidden sm:inline">Poll every</span>
        <select
          value={paymentsPollingMs}
          onChange={(e) =>
            setUiPrefs({ paymentsPollingMs: normalizePollingInterval(e.target.value) })
          }
          className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={ariaLabel}
          title="Background refresh interval (syncs across your devices)"
        >
          {PAYMENTS_POLLING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
