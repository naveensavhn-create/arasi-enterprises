import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const Route = createFileRoute("/_authenticated/promoter/collections")({
  head: () => ({ meta: [{ title: "Collections — Arasi Enterprises" }] }),
  component: () => <ComingSoon title="Collections" />,
});
