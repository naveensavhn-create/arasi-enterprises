import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/customer/referrals")({
  head: () => ({ meta: [{ title: "Referrals — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Referrals" />,
});
