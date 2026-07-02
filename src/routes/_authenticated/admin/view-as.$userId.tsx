import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, ShieldAlert, UserCog, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  endImpersonation,
  getActiveImpersonation,
  getAdminUserSnapshot,
  startImpersonation,
  type AdminUserSnapshot,
} from "@/lib/impersonation.functions";

export const Route = createFileRoute("/_authenticated/admin/view-as/$userId")({
  head: () => ({ meta: [{ title: "View as user — Admin" }] }),
  component: ViewAsPage,
});

function ViewAsPage() {
  const { userId } = Route.useParams();
  const snapshotFn = useServerFn(getAdminUserSnapshot);
  const activeFn = useServerFn(getActiveImpersonation);
  const startFn = useServerFn(startImpersonation);
  const endFn = useServerFn(endImpersonation);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const snap = useQuery({
    queryKey: ["admin-user-snapshot", userId],
    queryFn: () => snapshotFn({ data: { user_id: userId } }),
  });
  const active = useQuery({
    queryKey: ["impersonation", "active"],
    queryFn: () => activeFn(),
  });

  const [mode, setMode] = useState<"read_only" | "full_access">("read_only");
  const [reason, setReason] = useState("");

  const start = useMutation({
    mutationFn: (m: "read_only" | "full_access") =>
      startFn({ data: { target_user_id: userId, mode: m, reason: reason || undefined } }),
    onSuccess: () => {
      toast.success("Impersonation session started");
      qc.invalidateQueries({ queryKey: ["impersonation"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const end = useMutation({
    mutationFn: () => endFn(),
    onSuccess: () => {
      toast.success("Impersonation ended");
      qc.invalidateQueries({ queryKey: ["impersonation"] });
      navigate({ to: "/admin/users" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (snap.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading user snapshot…</div>;
  if (snap.error) return <div className="p-6 text-sm text-destructive">Failed to load: {(snap.error as Error).message}</div>;
  if (!snap.data) return <div className="p-6 text-sm">User not found.</div>;

  const s: AdminUserSnapshot = snap.data;
  const profile = (s.profile ?? {}) as Record<string, unknown>;
  const activeMembership = (s.memberships[0] as Record<string, unknown> | undefined) ?? null;
  const isActiveHere = active.data?.target_user_id === userId;
  const role = s.role ?? "customer";
  const displayId =
    role === "promoter" ? s.promoter_display_id : s.customer_display_id;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin/users"><ArrowLeft className="mr-1 h-4 w-4" /> Back to users</Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">
            {(profile.full_name as string) || (profile.email as string) || "User"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="capitalize">{role}</Badge>
            {displayId ? <Badge variant="outline">ID #{displayId}</Badge> : null}
            {s.promoter_referral_code ? <Badge variant="outline">REF {s.promoter_referral_code}</Badge> : null}
            {activeMembership?.membership_number ? (
              <Badge variant="outline">{String(activeMembership.membership_number)}</Badge>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isActiveHere ? (
            <Button size="sm" variant="destructive" onClick={() => end.mutate()} disabled={end.isPending}>
              <LogOut className="mr-1 h-4 w-4" /> End impersonation
            </Button>
          ) : (
            <>
              <Select value={mode} onValueChange={(v) => setMode(v as "read_only" | "full_access")}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read_only">Read-only</SelectItem>
                  <SelectItem value="full_access">Full access</SelectItem>
                </SelectContent>
              </Select>
              {mode === "full_access" ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="default" disabled={start.isPending}>
                      <ShieldAlert className="mr-1 h-4 w-4" /> Start full access
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Enter Full Access Mode?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You are about to enter Full Access Mode as this user.
                        All actions performed will be recorded in the audit log.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <input
                      className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                      placeholder="Reason (optional)"
                      value={reason} onChange={(e) => setReason(e.target.value)}
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => start.mutate("full_access")}>
                        Confirm full access
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button size="sm" onClick={() => start.mutate("read_only")} disabled={start.isPending}>
                  <UserCog className="mr-1 h-4 w-4" /> Start read-only session
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <SnapshotView snap={s} />
    </div>
  );
}

function SnapshotView({ snap }: { snap: AdminUserSnapshot }) {
  const profile = (snap.profile ?? {}) as Record<string, unknown>;
  const auth = (snap.auth ?? {}) as Record<string, unknown>;
  const rank = (snap.rank_state ?? {}) as Record<string, unknown>;
  const isPromoter = snap.role === "promoter";
  const referredBy = snap.referred_by as Record<string, unknown> | null;

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="flex flex-wrap">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="membership">Membership</TabsTrigger>
        <TabsTrigger value="installments">Installments</TabsTrigger>
        <TabsTrigger value="payments">Payments</TabsTrigger>
        <TabsTrigger value="receipts">Receipts</TabsTrigger>
        <TabsTrigger value="rewards">Rewards</TabsTrigger>
        <TabsTrigger value="draws">Lucky draws</TabsTrigger>
        {isPromoter && <TabsTrigger value="commissions">Commissions</TabsTrigger>}
        <TabsTrigger value="referrals">Referrals</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="profile">Profile / KYC</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Memberships" value={snap.memberships.length} />
          <Stat label="Installments" value={snap.installments.length} />
          <Stat label="Payments" value={snap.payments.length} />
          <Stat label="Receipts" value={snap.receipts.length} />
          <Stat label="Rewards" value={snap.rewards.length} />
          <Stat label="Draw entries" value={snap.draw_entries.length} />
          <Stat label="Draw wins" value={snap.draw_wins.length} />
          <Stat label="Referrals" value={snap.referrals.length} />
        </div>
        {referredBy ? (
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Referred by</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {String(referredBy.full_name || referredBy.email || referredBy.id)}
            </CardContent>
          </Card>
        ) : null}
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-base">Auth</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
            <Field label="Created" value={fmt(auth.created_at)} />
            <Field label="Last sign-in" value={fmt(auth.last_sign_in_at)} />
            <Field label="Banned until" value={fmt(auth.banned_until) || "—"} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="membership">
        <RowsTable
          rows={snap.memberships}
          cols={["membership_number", "member_display_id", "coupon_no", "status", "plan_id", "start_date", "end_date", "paid_amount"]}
        />
      </TabsContent>
      <TabsContent value="installments">
        <RowsTable rows={snap.installments} cols={["sequence", "due_date", "amount", "status", "paid_at"]} />
      </TabsContent>
      <TabsContent value="payments">
        <RowsTable rows={snap.payments} cols={["created_at", "amount", "status", "method", "provider_payment_id", "installment_id"]} />
      </TabsContent>
      <TabsContent value="receipts">
        <RowsTable rows={snap.receipts} cols={["receipt_number", "issued_at", "amount", "payment_method", "voided_at"]} />
      </TabsContent>
      <TabsContent value="rewards">
        <RowsTable rows={snap.rewards} cols={["reward_number", "status", "unlocked_at", "requested_at", "delivered_at"]} />
      </TabsContent>
      <TabsContent value="draws">
        <div className="space-y-4">
          <div><h3 className="mb-2 text-sm font-medium">Entries</h3>
            <RowsTable rows={snap.draw_entries} cols={["draw_id", "entry_code", "coupon_code", "eligible", "created_at"]} /></div>
          <div><h3 className="mb-2 text-sm font-medium">Wins</h3>
            <RowsTable rows={snap.draw_wins} cols={["draw_id", "position", "prize", "created_at"]} /></div>
        </div>
      </TabsContent>
      {isPromoter && (
        <TabsContent value="commissions">
          <Card className="mb-3">
            <CardHeader><CardTitle className="text-base">Rank state</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-4">
              <Field label="Current rank" value={String(rank.current_rank_id ?? "—")} />
              <Field label="Active customers" value={String(rank.active_customers ?? 0)} />
              <Field label="Last recompute" value={fmt(rank.updated_at)} />
            </CardContent>
          </Card>
          <RowsTable rows={snap.commissions} cols={["ledger_number", "commission_amount", "commission_percent", "status", "payment_date", "approved_at"]} />
        </TabsContent>
      )}
      <TabsContent value="referrals">
        <RowsTable rows={snap.referrals} cols={["full_name", "email", "kyc_status", "created_at"]} />
      </TabsContent>
      <TabsContent value="notifications">
        <RowsTable rows={snap.notifications} cols={["type", "title", "body", "created_at", "read_at"]} />
      </TabsContent>
      <TabsContent value="profile">
        <Card>
          <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Field label="Full name" value={String(profile.full_name ?? "—")} />
            <Field label="Email" value={String(profile.email ?? "—")} />
            <Field label="Phone" value={String(profile.phone ?? "—")} />
            <Field label="City" value={String(profile.city ?? "—")} />
            <Field label="State" value={String(profile.state ?? "—")} />
            <Field label="Postal code" value={String(profile.postal_code ?? "—")} />
            <Field label="Country" value={String(profile.country ?? "—")} />
            <Field label="Address line 1" value={String(profile.address_line1 ?? "—")} />
            <Field label="Address line 2" value={String(profile.address_line2 ?? "—")} />
            <Field label="Aadhaar number" value={String(profile.aadhaar_number ?? "—")} />
            <Field label="Aadhaar address" value={String(profile.aadhaar_address ?? "—")} />
            <Field label="KYC status" value={String(profile.kyc_status ?? "—")} />
            <Field label="KYC submitted" value={fmt(profile.kyc_submitted_at)} />
            <Field label="KYC reviewed" value={fmt(profile.kyc_reviewed_at)} />
            <Field label="KYC notes" value={String(profile.kyc_review_notes ?? "—")} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </CardContent></Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words">{value || "—"}</div></div>
  );
}

function fmt(v: unknown): string {
  if (!v) return "";
  try { return new Date(String(v)).toLocaleString(); } catch { return String(v); }
}

function RowsTable({ rows, cols }: { rows: unknown[]; cols: string[] }) {
  if (!rows.length) return <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">No records.</div>;
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader><TableRow>{cols.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {(rows as Array<Record<string, unknown>>).map((r, i) => (
            <TableRow key={String(r.id ?? i)}>
              {cols.map((c) => {
                const raw = r[c];
                const display = raw == null ? "—" :
                  typeof raw === "object" ? JSON.stringify(raw) :
                  /_at$|date/i.test(c) ? fmt(raw) : String(raw);
                return <TableCell key={c} className="max-w-[240px] truncate text-xs">{display}</TableCell>;
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
