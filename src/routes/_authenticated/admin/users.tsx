import { createFileRoute } from "@tanstack/react-router";
import { UsersManagementTable } from "@/components/admin/UsersManagementTable";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users — Admin" }] }),
  component: AdminUsersPage,
});

function AdminUsersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          View, edit, disable, approve or reject any user. Customers auto-receive IDs from 1001; promoters get a 5-digit ID + referral code.
        </p>
      </div>
      <UsersManagementTable />
    </div>
  );
}
