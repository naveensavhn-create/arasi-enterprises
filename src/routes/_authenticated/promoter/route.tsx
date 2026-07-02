import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getMyRole } from "@/lib/roles.functions";
import { Forbidden, ForbiddenError } from "@/components/access/Forbidden";
import { useDrawRealtime } from "@/hooks/use-draw-realtime";

function PromoterLayout() {
  useDrawRealtime({
    queryKeys: [
      ["dashboard", "next-draw"],
      ["promoter", "lucky-draw"],
    ],
  });
  return <Outlet />;
}

export const Route = createFileRoute("/_authenticated/promoter")({
  beforeLoad: async () => {
    const role = await getMyRole();
    if (role !== "promoter" && role !== "admin") {
      throw new ForbiddenError(["promoter", "admin"], role);
    }
    return { role };
  },
  errorComponent: ({ error }) => {
    if (error instanceof ForbiddenError) {
      return <Forbidden required={error.required} actual={error.actual} />;
    }
    return (
      <div className="p-6 text-sm text-destructive">
        {error instanceof Error ? error.message : "Something went wrong."}
      </div>
    );
  },
  component: PromoterLayout,
});
