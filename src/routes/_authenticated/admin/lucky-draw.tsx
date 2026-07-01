import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/admin/lucky-draw")({
  head: () => ({ meta: [{ title: "Lucky Draw — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Lucky Draw" />,
});
