import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/promoter/portfolio")({
  head: () => ({ meta: [{ title: "Portfolio — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Portfolio" />,
});
