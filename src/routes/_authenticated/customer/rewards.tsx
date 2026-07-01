import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/customer/rewards")({
  head: () => ({ meta: [{ title: "Rewards — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Rewards" />,
});
