import { createFileRoute } from "@tanstack/react-router";
import { UsersManagementTable } from "@/components/admin/UsersManagementTable";

export const Route = createFileRoute("/_authenticated/admin/customers")({
  head: () => ({ meta: [{ title: "Customers — Admin" }] }),
  component: AdminCustomersPage,
});

function AdminCustomersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">
          View, edit, disable, approve or reject customer accounts. Use the row menu for KYC actions and access control.
        </p>
      </div>
      <UsersManagementTable
        roleFilter="customer"
        title="Customers"
        searchPlaceholder="Search name, email, phone, member ID…"
      />
    </div>
  );
}
