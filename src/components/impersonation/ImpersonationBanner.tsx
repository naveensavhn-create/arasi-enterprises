import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { UserCog, X, ShieldAlert, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { endImpersonation, getActiveImpersonation } from "@/lib/impersonation.functions";

export function useActiveImpersonation() {
  const fn = useServerFn(getActiveImpersonation);
  return useQuery({
    queryKey: ["impersonation", "active"],
    queryFn: () => fn(),
    staleTime: 30_000,
    retry: false,
  });
}

export function ImpersonationBanner() {
  const { data } = useActiveImpersonation();
  const endFn = useServerFn(endImpersonation);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const end = useMutation({
    mutationFn: () => endFn(),
    onSuccess: () => {
      toast.success("Impersonation ended");
      qc.invalidateQueries({ queryKey: ["impersonation"] });
      navigate({ to: "/admin" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return null;

  const label =
    data.target_full_name || data.target_email || data.target_user_id;
  const idBadge =
    data.target_role === "promoter"
      ? data.target_promoter_display_id
        ? `Promoter #${data.target_promoter_display_id}`
        : "Promoter"
      : data.target_customer_display_id
        ? `Customer #${data.target_customer_display_id}`
        : data.target_membership_number || "Customer";

  return (
    <div
      role="alert"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/95 px-4 py-2 text-sm font-medium text-amber-950 shadow"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-semibold">You are viewing this account as Super Admin.</span>
      <span className="flex flex-wrap items-center gap-2">
        <UserCog className="h-4 w-4" aria-hidden="true" />
        <span>{label}</span>
        <Badge variant="outline" className="border-amber-900/40 bg-amber-100 text-amber-900">
          {idBadge}
        </Badge>
        <Badge variant="outline" className="border-amber-900/40 bg-amber-100 capitalize text-amber-900">
          {data.target_role}
        </Badge>
        <Badge variant="outline" className="border-amber-900/40 bg-amber-100 text-amber-900">
          {data.mode === "full_access" ? "Full access" : "Read-only"}
        </Badge>
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="border-amber-900/50 bg-white text-amber-950 hover:bg-amber-50"
          onClick={() =>
            navigate({ to: "/admin/view-as/$userId", params: { userId: data.target_user_id } })
          }
        >
          <Eye className="mr-1 h-4 w-4" /> Open view
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => end.mutate()}
          disabled={end.isPending}
        >
          <X className="mr-1 h-4 w-4" /> Return to Admin Dashboard
        </Button>
      </div>
    </div>
  );
}
