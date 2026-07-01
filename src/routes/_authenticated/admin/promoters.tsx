import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/admin/promoters")({
  head: () => ({ meta: [{ title: "Promoters — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Promoters" />,
});
