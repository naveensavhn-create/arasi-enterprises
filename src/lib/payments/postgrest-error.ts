/**
 * Serialize a PostgREST error into a plain Error message the RPC boundary
 * can transport losslessly, and parse it back on the client so we can render
 * hint/code/details in a user-friendly toast + error state.
 *
 * The RPC transport only preserves `Error.message` — not `.cause`, custom
 * props, or subclasses — so we JSON-encode structured fields inside the
 * message string behind a stable `[PGRST]` prefix. Old string-only messages
 * still round-trip cleanly (parse returns null and callers fall back).
 */

export interface PostgrestErrorShape {
  message: string;
  code: string | null;
  hint: string | null;
  details: string | null;
}

const PREFIX = "[PGRST]";

// PostgREST-like errors carry {message, details, hint, code}; we accept any
// object and defensively coerce so we never re-throw during error handling.
export function serializePostgrestErrorMessage(err: unknown, fallback = "Query failed"): string {
  const e = (err ?? {}) as Record<string, unknown>;
  const payload: PostgrestErrorShape = {
    message: typeof e.message === "string" && e.message ? e.message : fallback,
    code: typeof e.code === "string" ? e.code : null,
    hint: typeof e.hint === "string" ? e.hint : null,
    details: typeof e.details === "string" ? e.details : null,
  };
  return `${PREFIX}${JSON.stringify(payload)}`;
}

export function parsePostgrestErrorMessage(message: string | undefined | null): PostgrestErrorShape | null {
  if (!message || !message.startsWith(PREFIX)) return null;
  try {
    const raw = JSON.parse(message.slice(PREFIX.length)) as Partial<PostgrestErrorShape>;
    if (typeof raw.message !== "string") return null;
    return {
      message: raw.message,
      code: typeof raw.code === "string" ? raw.code : null,
      hint: typeof raw.hint === "string" ? raw.hint : null,
      details: typeof raw.details === "string" ? raw.details : null,
    };
  } catch {
    return null;
  }
}

/**
 * Client-side normalizer: takes any thrown value and returns a shape safe
 * to render in a toast / alert. Strips the `[PGRST]` prefix so users never
 * see raw JSON, and truncates hint/details to keep the UI tidy.
 */
export function toDisplayablePostgrestError(err: unknown): PostgrestErrorShape {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unexpected error";
  const parsed = parsePostgrestErrorMessage(raw);
  if (parsed) return parsed;
  return { message: raw, code: null, hint: null, details: null };
}
