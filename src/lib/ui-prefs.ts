import { useEffect, useSyncExternalStore } from "react";

export type SidebarMode = "expanded" | "collapsed";
export type Density = "comfortable" | "compact";

export type UiPrefs = {
  sidebarMode: SidebarMode;
  density: Density;
};

const DEFAULTS: UiPrefs = { sidebarMode: "expanded", density: "comfortable" };
const KEY = "arasi:ui-prefs";

const listeners = new Set<() => void>();

function read(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      sidebarMode: parsed.sidebarMode === "collapsed" ? "collapsed" : "expanded",
      density: parsed.density === "compact" ? "compact" : "comfortable",
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
