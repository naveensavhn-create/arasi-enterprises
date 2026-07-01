import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/promoter/commissions")({
  head: () => ({ meta: [{ title: "Commissions — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Commissions" />,
});
