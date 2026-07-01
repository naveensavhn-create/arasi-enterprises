import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/promoter/customers")({
  head: () => ({ meta: [{ title: "My Customers — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="My Customers" />,
});
