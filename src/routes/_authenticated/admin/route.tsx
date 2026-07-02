import { createFileRoute, Outlet, redirect, useRouter, isRedirect } from "@tanstack/react-router";
import { getMyRole } from "@/lib/roles.functions";
import { getAdminBootstrapStatus } from "@/lib/admin.functions";
import { Forbidden, ForbiddenError } from "@/components/access/Forbidden";
import { RouteLoading, RouteError } from "@/components/RouteLoading";


export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ location }) => {
    try {
      const role = await getMyRole();
      if (role === "admin") return { role };

      // Bootstrap escape hatch: if no admin exists yet, ANY authenticated user
      // may reach /admin/settings to claim the first admin role. Every other
      // /admin/* URL stays locked.
      if (location.pathname === "/admin/settings") {
        const { hasAdmin } = await getAdminBootstrapStatus();
        if (!hasAdmin) return { role };
      }

      throw new ForbiddenError("admin", role);
    } catch (err) {
      if (isRedirect(err) || err instanceof ForbiddenError) throw err;
      // Re-throw so errorComponent renders a real message instead of a blank page.
      throw err;
    }
  },
  pendingComponent: () => <RouteLoading label="Loading admin portal…" />,
  pendingMs: 0,
  pendingMinMs: 300,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    if (error instanceof ForbiddenError) {
      return <Forbidden required={error.required} actual={error.actual} />;
    }
    return (
      <RouteError
        error={error}
        onRetry={() => {
          router.invalidate();
          reset();
        }}
      />
    );
  },
  // Any unknown child under /admin (e.g. a stray `/admin/admin` from a
  // relative link) should quietly redirect to the shared dashboard instead
  // of surfacing a route-match error.
  notFoundComponent: () => {
    throw redirect({ to: "/dashboard" });
  },
  component: () => <Outlet />,
});

