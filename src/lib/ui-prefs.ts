import { useEffect, useSyncExternalStore } from "react";

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

function normalizePolling(v: unknown): PaymentsPollingMs {
  const n = typeof v === "number" ? v : Number(v);
  return ([0, 30_000, 60_000, 120_000] as const).includes(n as PaymentsPollingMs)
    ? (n as PaymentsPollingMs)
    : DEFAULTS.paymentsPollingMs;
}

function read(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      sidebarMode: parsed.sidebarMode === "collapsed" ? "collapsed" : "expanded",
      density: parsed.density === "compact" ? "compact" : "comfortable",
      paymentsPollingMs: normalizePolling(parsed.paymentsPollingMs),
    };
  } catch {
    return DEFAULTS;
  }
}

function write(next: UiPrefs) {
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

export function setUiPrefs(patch: Partial<UiPrefs>) {
  const next = { ...read(), ...patch };
  write(next);
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
