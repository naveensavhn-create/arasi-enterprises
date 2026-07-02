/**
 * Server-side rate limiter backed by `public.try_consume_rate_limit`
 * (Postgres advisory-lock + upsert). Best-effort per-instance limiting —
 * NOT a WAF replacement. Applied at the app layer to the highest-risk
 * server functions: sign-in, KYC submit, exports, winner picks,
 * impersonation.
 *
 * Usage inside a server function:
 *
 *   await consumeRateLimit({
 *     key: `login:${ip}`,
 *     limit: 10,
 *     windowSeconds: 900,
 *   });
 *
 * Throws `RateLimitError` (code = 'RATE_LIMITED') when the caller is over
 * budget so route boundaries can render a friendly 429-style message.
 */

export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED" as const;
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Too many requests. Please try again shortly.") {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ConsumeArgs = {
  /** Unique bucket key. Combine action + identity (e.g. user id, IP). */
  key: string;
  /** Maximum allowed hits within the window. */
  limit: number;
  /** Rolling window length in seconds. */
  windowSeconds: number;
};

/**
 * Consume one token against the given bucket. Uses supabaseAdmin because
 * the underlying SQL function is scoped to service_role and callers must
 * be able to consume even before an identity is fully established
 * (e.g. failed-login counting). This helper is server-only.
 */
export async function consumeRateLimit(args: ConsumeArgs): Promise<void> {
  const { key, limit, windowSeconds } = args;
  if (!key) throw new Error("consumeRateLimit: key is required");
  if (limit <= 0 || windowSeconds <= 0) {
    throw new Error("consumeRateLimit: limit and windowSeconds must be positive");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("try_consume_rate_limit", {
    _key: key,
    _limit: limit,
    _window_seconds: windowSeconds,
  });

  if (error) {
    // Fail-open on infrastructure errors so a transient DB blip does
    // not lock everyone out; log so it shows up in monitoring.
    console.error("[rate-limit] try_consume failed; failing open", { key, error: error.message });
    return;
  }

  if (data === false) {
    throw new RateLimitError(windowSeconds);
  }
}

/** Utility: build a stable per-user-per-action key. */
export function userActionKey(action: string, userId: string): string {
  return `u:${action}:${userId}`;
}

/** Utility: build a stable per-IP-per-action key (for pre-auth flows). */
export function ipActionKey(action: string, ip: string | null | undefined): string {
  return `ip:${action}:${ip ?? "unknown"}`;
}
