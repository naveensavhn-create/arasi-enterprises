import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { withSecurityHeaders } from "./lib/security-headers.server";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Applies the shared HTTP security header set (CSP, Referrer-Policy,
 * X-Content-Type-Options, X-Frame-Options, Permissions-Policy, COOP,
 * CORP) to every server response — SSR pages, server-fn RPC responses,
 * and `/api/public/*` routes alike. Handler-set headers are preserved.
 */
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = (result as unknown as { response?: Response }).response;
  if (response instanceof Response) {
    (result as unknown as { response: Response }).response = withSecurityHeaders(response);
  }
  return result;
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, securityHeadersMiddleware],
}));

