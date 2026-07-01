import { useEffect, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyUiPrefs, saveMyUiPrefs } from "@/lib/ui-prefs.functions";

export type SidebarMode = "expanded" | "collapsed";
export type Density = "comfortable" | "compact";
/** Payments-page polling fallback in ms. 0 = disabled. */
export type PaymentsPollingMs = 0 | 30_000 | 60_000 | 120_000;

export const PAYMENTS_POLLING_OPTIONS: { value: PaymentsPollingMs; label: string }[] = [
  { value: 30_000, label: "30 seconds" },
  { value: 60_000, label: "60 seconds" },
  { value: 120_000, label: "2 minutes" },
  { value: 0, label: "Off" },
];

export type UiPrefs = {
  sidebarMode: SidebarMode;
  density: Density;
  paymentsPollingMs: PaymentsPollingMs;
};

const DEFAULTS: UiPrefs = {
  sidebarMode: "expanded",
  density: "comfortable",
  paymentsPollingMs: 30_000,
};
const KEY = "arasi:ui-prefs";

const listeners = new Set<() => void>();

/** Valid polling intervals in ms (0 = disabled). Exported for validation. */
export const VALID_PAYMENTS_POLLING_MS = [0, 30_000, 60_000, 120_000] as const;

/**
 * Runtime validator for the payments-page polling interval preference.
 * Returns the input when it's a known valid value; otherwise falls back to
 * the safe default (30s). Handles unknown, null, NaN, strings, negatives,
 * and legacy values that predate the current option set.
 */
export function normalizePollingInterval(v: unknown): PaymentsPollingMs {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULTS.paymentsPollingMs;
  return (VALID_PAYMENTS_POLLING_MS as readonly number[]).includes(n)
    ? (n as PaymentsPollingMs)
    : DEFAULTS.paymentsPollingMs;
}


function coerce(parsed: Partial<UiPrefs> | undefined | null): UiPrefs {
  const p = parsed ?? {};
  return {
    sidebarMode: p.sidebarMode === "collapsed" ? "collapsed" : "expanded",
    density: p.density === "compact" ? "compact" : "comfortable",
    paymentsPollingMs: normalizePolling(p.paymentsPollingMs),
  };
}

function read(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return coerce(JSON.parse(raw) as Partial<UiPrefs>);
  } catch {
    return DEFAULTS;
  }
}

function writeLocal(next: UiPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage disabled */
  }
  applyDensity(next.density);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function applyDensity(density: Density) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = density;
}

export function getUiPrefs(): UiPrefs {
  return read();
}

// -------- Server sync ------------------------------------------------------

/**
 * When a user is signed in, prefs live server-side (public.user_ui_prefs) so
 * they follow the user across devices. localStorage is a per-device cache used
 * for instant paint and offline resilience.
 *
 * Writes are debounced and coalesced — rapid setUiPrefs calls turn into one
 * upsert with the latest patch merged server-side. Pending patches are held
 * per key so a slow request can't clobber a newer preference.
 */
type PatchQueue = Partial<UiPrefs>;
let pendingPatch: PatchQueue = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let saveImpl: ((patch: PatchQueue) => Promise<unknown>) | null = null;
let syncEnabled = false;

const FLUSH_DELAY_MS = 400;

function scheduleFlush() {
  if (!syncEnabled || !saveImpl) return;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!saveImpl) return;
    const patch = pendingPatch;
    pendingPatch = {};
    if (Object.keys(patch).length === 0) return;
    try {
      await saveImpl(patch);
    } catch {
      // Keep the local value; next successful save (or hydration on next
      // sign-in) will reconcile. Silent to avoid noisy toasts on flaky nets.
    }
  }, FLUSH_DELAY_MS);
}

export function setUiPrefs(patch: Partial<UiPrefs>) {
  const next = { ...read(), ...patch };
  writeLocal(next);
  // Queue only the keys the caller actually changed so we don't echo
  // unrelated values back to the server.
  pendingPatch = { ...pendingPatch, ...patch };
  scheduleFlush();
}

export function useUiPrefs(): UiPrefs {
  const snap = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(read()),
    () => JSON.stringify(DEFAULTS),
  );
  return JSON.parse(snap) as UiPrefs;
}

/** Call once at app boot to sync the density attribute with saved prefs. */
export function useApplyUiPrefs() {
  const prefs = useUiPrefs();
  useEffect(() => {
    applyDensity(prefs.density);
  }, [prefs.density]);
}

/**
 * Wire the local prefs store to the signed-in user's server-side prefs.
 * - On mount / user change: hydrate from server (server wins on conflict).
 * - On sign-out: disable sync and stop flushing (local cache stays).
 */
export function useSyncUiPrefsWithServer(userId: string | null | undefined) {
  const fetchPrefs = useServerFn(getMyUiPrefs);
  const savePrefs = useServerFn(saveMyUiPrefs);

  useEffect(() => {
    if (!userId) {
      syncEnabled = false;
      saveImpl = null;
      return;
    }
    syncEnabled = true;
    saveImpl = (patch) => savePrefs({ data: patch });

    let cancelled = false;
    (async () => {
      try {
        const res = await fetchPrefs();
        if (cancelled) return;
        const serverPrefs = coerce(res?.prefs as Partial<UiPrefs>);
        // Server is source of truth on hydration; overwrite local cache.
        writeLocal(serverPrefs);
      } catch {
        // Offline / first load — keep the local cache as-is.
      }
    })();

    return () => {
      cancelled = true;
      // Flush any queued patch immediately when the user changes so we don't
      // leak one user's pending edit into another's session.
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const patch = pendingPatch;
      pendingPatch = {};
      if (Object.keys(patch).length > 0 && saveImpl) {
        void saveImpl(patch).catch(() => {});
      }
      syncEnabled = false;
      saveImpl = null;
    };
  }, [userId, fetchPrefs, savePrefs]);
}
