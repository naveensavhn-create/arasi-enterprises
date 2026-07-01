import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getMyRole } from "@/lib/roles.functions";
import { Forbidden, ForbiddenError } from "@/components/access/Forbidden";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const role = await getMyRole();
    if (role !== "admin") throw new ForbiddenError("admin", role);
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
