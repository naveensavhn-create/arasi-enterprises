import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getMyRole } from "@/lib/roles.functions";
import { Forbidden, ForbiddenError } from "@/components/access/Forbidden";
import { useDrawRealtime } from "@/hooks/use-draw-realtime";

function CustomerLayout() {
  useDrawRealtime({
    queryKeys: [
      ["dashboard", "next-draw"],
      ["customer", "lucky-draw"],
      ["customer", "draw-results"],
    ],
  });
  return <Outlet />;
}

export const Route = createFileRoute("/_authenticated/customer")({
  beforeLoad: async () => {
    const role = await getMyRole();
    if (role !== "customer" && role !== "admin") {
      throw new ForbiddenError(["customer", "admin"], role);
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
  component: () => <Outlet />,
});
