import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getMyRole } from "@/lib/roles.functions";
import { getAdminBootstrapStatus } from "@/lib/admin.functions";
import { Forbidden, ForbiddenError } from "@/components/access/Forbidden";


export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ location }) => {
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
  },
  errorComponent: ({ error }) => {
    if (error instanceof ForbiddenError) {
      return <Forbidden required={error.required} actual={error.actual} />;
    }
    return (
      <div className="p-6 text-sm text-destructive">
        {error instanceof Error ? error.message : "Something went wrong."}
      </div>
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

