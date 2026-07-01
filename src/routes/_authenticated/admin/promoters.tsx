import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserCog } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/promoters")({
  head: () => ({ meta: [{ title: "Promoters — Admin" }] }),
  component: AdminPromotersPage,
});

type Row = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string;
};

function AdminPromotersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-promoters"],
    queryFn: async (): Promise<Row[]> => {
      const { data: roleRows, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "promoter");
      if (rErr) throw rErr;
      const ids = (roleRows ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, status, created_at")
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Promoters</h1>
        <p className="text-sm text-muted-foreground">
          Field agents who onboard and support customers. Assign the promoter role from Settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4" /> {data?.length ?? 0} promoter{data?.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load promoters.</p>
          ) : !data || data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No promoters yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Phone</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{r.full_name || "—"}</td>
                      <td className="py-2 pr-4">{r.email || "—"}</td>
                      <td className="py-2 pr-4">{r.phone || "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.status === "active" ? "default" : "secondary"} className="capitalize">
                          {r.status ?? "active"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
