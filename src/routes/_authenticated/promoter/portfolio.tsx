import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { applyPaymentStatusEq } from "@/lib/payments/status-filter";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Briefcase } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/promoter/portfolio")({
  head: () => ({ meta: [{ title: "Portfolio — Promoter" }] }),
  component: PromoterPortfolioPage,
});

function PromoterPortfolioPage() {
  const { session } = useSession();
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-profile", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .eq("id", session!.user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["promoter-stats", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const [ms, ps] = await Promise.all([
        supabase.from("memberships").select("id, total_amount, paid_amount").eq("promoter_id", session!.user.id),
        supabase
          .from("payments")
          .select("amount, memberships!inner(promoter_id)")
          .filter("status::text", "eq", "paid")
          .eq("memberships.promoter_id", session!.user.id),
      ]);
      const mems = ms.data ?? [];
      const pays = ps.data ?? [];
      return {
        memberships: mems.length,
        committed: mems.reduce((a, m) => a + Number(m.total_amount ?? 0), 0),
        collected: pays.reduce((a, p) => a + Number(p.amount ?? 0), 0),
      };
    },
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    if (profile) {
      setName(profile.full_name ?? "");
      setPhone(profile.phone ?? "");
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name, phone })
        .eq("id", session!.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted-foreground">
          Your performance snapshot and public profile.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Memberships</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{stats?.memberships ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Committed</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            ₹{(stats?.committed ?? 0).toLocaleString("en-IN")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Collected</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-gradient-gold">
            ₹{(stats?.collected ?? 0).toLocaleString("en-IN")}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Profile</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid max-w-md gap-3">
              <div className="grid gap-1.5">
                <Label>Full name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input value={profile?.email ?? ""} disabled />
              </div>
              <div>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
