/**
 * Shared HTTP security header set applied to every server response.
 *
 * Intent: strict defaults, only opened up for the origins the app actually
 * needs (Supabase Data API + auth, Razorpay checkout, Cloudinary media,
 * Google Fonts for the landing serif).
 *
 * These are safe to serve on every request — including SSR HTML, server
 * fn RPC responses, and public `/api/public/*` routes. They coexist with
 * the platform's HSTS/TLS enforcement at the edge.
 *
 * If a new external origin is introduced (e.g. a new payment provider or
 * image host), update the corresponding `-src` directive here — never
 * relax to `*` or add `unsafe-eval`.
 */

const SUPABASE_ORIGIN = (() => {
  try {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
})();

const CSP_DIRECTIVES = [
  "default-src 'self'",
  // TanStack Start hydration and Vite HMR both inline scripts; we allow
  // 'unsafe-inline' for scripts only in development, not in production.
  process.env.NODE_ENV === "production"
    ? "script-src 'self' https://checkout.razorpay.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com",
  // Tailwind + shadcn ship as static CSS; runtime style tags need inline.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://res.cloudinary.com https://*.supabase.co",
  [
    "connect-src 'self'",
    SUPABASE_ORIGIN,
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://api.razorpay.com",
    "https://lumberjack.razorpay.com",
  ]
    .filter(Boolean)
    .join(" "),
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.razorpay.com",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": CSP_DIRECTIVES,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": [
    "accelerometer=()",
    "camera=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "payment=(self \"https://checkout.razorpay.com\")",
    "usb=()",
  ].join(", "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
});

/**
 * Merge {@link SECURITY_HEADERS} into an existing Response, preserving the
 * response body/status and only overriding security-relevant headers.
 * Handler-set values win when they are stricter (never override a stricter
 * per-route CSP), so we only set our defaults when the header is absent.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
