import { createFileRoute, redirect } from "@tanstack/react-router";

// Bare `/admin` (and any stray relative navigation that resolves to it,
// e.g. `/admin/admin`) has no page of its own — always send the user to the
// shared dashboard so the router never lands on an unmatched admin URL.
export const Route = createFileRoute("/_authenticated/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
