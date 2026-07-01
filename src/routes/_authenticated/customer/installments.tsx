import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/customer/installments")({
  head: () => ({ meta: [{ title: "Installments — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Installments" />,
});
