import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Users } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_authenticated/admin/customers")({
  head: () => ({ meta: [{ title: "Customers — Admin" }] }),
  component: AdminCustomersPage,
});

type Row = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string;
};

function AdminCustomersPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async (): Promise<Row[]> => {
      const { data: roleRows, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "customer");
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

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter(
      (r) =>
        r.full_name?.toLowerCase().includes(s) ||
        r.email?.toLowerCase().includes(s) ||
        r.phone?.toLowerCase().includes(s)
    );
  }, [data, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            All registered customer accounts.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone…"
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> {filtered.length} customer{filtered.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load customers.</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No customers found.</p>
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
                  {filtered.map((r) => (
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
