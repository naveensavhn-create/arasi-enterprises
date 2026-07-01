import { createFileRoute, redirect } from "@tanstack/react-router";

// Catch any unknown child under /admin (e.g. a stray `/admin/admin` produced
// by a relative link) and quietly redirect to the shared dashboard so the
// router never surfaces a route-match error.
export const Route = createFileRoute("/_authenticated/admin/$")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
