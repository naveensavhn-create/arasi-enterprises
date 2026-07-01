import type { AppRole } from "@/lib/auth";

export const LAST_VISITED_PREFIX = "arasi:last-path:";

export function lastVisitedKey(userId: string, role: AppRole) {
  return `${LAST_VISITED_PREFIX}${userId}:${role}`;
}

export function readLastVisited(userId: string, role: AppRole): string | null {
  try {
    const v = localStorage.getItem(lastVisitedKey(userId, role));
    if (!v) return null;
    // Only accept role-scoped, in-app paths.
    if (!v.startsWith(`/${role}/`)) return null;
    return v;
  } catch {
    return null;
  }
}

export function clearLastVisited(userId: string) {
  try {
    for (const role of ["admin", "promoter", "customer"] as AppRole[]) {
      localStorage.removeItem(lastVisitedKey(userId, role));
    }
  } catch {
    /* noop */
  }
}
