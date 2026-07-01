import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/customer/membership")({
  head: () => ({ meta: [{ title: "Membership — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Membership" />,
});
