import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/admin/plans")({
  head: () => ({ meta: [{ title: "Plans — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Plans" />,
});
