import { createFileRoute } from "@tanstack/react-router";
import { UsersManagementTable } from "@/components/admin/UsersManagementTable";

export const Route = createFileRoute("/_authenticated/admin/promoters")({
  head: () => ({ meta: [{ title: "Promoters — Admin" }] }),
  component: AdminPromotersPage,
});

function AdminPromotersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Promoters</h1>
        <p className="text-sm text-muted-foreground">
          Field agents who onboard and support customers. View, edit, disable, approve or reject promoter accounts from the row menu.
        </p>
      </div>
      <UsersManagementTable
        roleFilter="promoter"
        title="Promoters"
        searchPlaceholder="Search name, email, phone, promoter ID, referral code…"
      />
    </div>
  );
}
