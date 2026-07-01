import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Mail,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  listMembershipEmailNotifications,
  listMembershipsForTest,
  sendMembershipActivatedTestEmail,
  type MembershipEmailNotification,
} from "@/lib/membership-emails.functions";

export const Route = createFileRoute("/_authenticated/admin/membership-emails")({
  head: () => ({
    meta: [{ title: "Membership Emails — Arasi Enterprises" }],
  }),
  component: MembershipEmailsPage,
});

const STATUS_META: Record<
  string,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  sent: { label: "Sent", className: "bg-green-500/15 text-green-700 border-green-500/30", Icon: CheckCircle2 },
  pending: { label: "Pending", className: "bg-blue-500/15 text-blue-700 border-blue-500/30", Icon: Clock },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-700 border-red-500/30", Icon: XCircle },
  skipped_no_email_infra: {
    label: "Skipped — no email infra",
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
    Icon: AlertCircle,
  },
  skipped_no_recipient: {
    label: "Skipped — no recipient",
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
    Icon: AlertCircle,
  },
  skipped_membership_not_found: {
    label: "Skipped — membership missing",
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
    Icon: AlertCircle,
  },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    className: "bg-muted text-foreground border-border",
    Icon: AlertCircle,
  };
  const { Icon } = meta;
  return (
    <Badge variant="outline" className={meta.className}>
      <Icon className="mr-1 h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function MembershipEmailsPage() {
  const queryClient = useQueryClient();

  const refetchInterval = useListRefetchInterval();
  const notificationsQuery = useQuery({
    queryKey: ["admin", "membership-email-notifications"],
    queryFn: () => listMembershipEmailNotifications(),
    refetchInterval,
  });

  const membershipsQuery = useQuery({
    queryKey: ["admin", "memberships-for-test"],
    queryFn: () => listMembershipsForTest(),
  });

  const sendTest = useServerFn(sendMembershipActivatedTestEmail);
  const testMutation = useMutation({
    mutationFn: (input: { membershipId: string; recipientEmail?: string }) =>
      sendTest({ data: input }),
    onSuccess: (res) => {
      if (res.status === "sent") {
        toast.success(`Test email sent to ${res.recipientEmail ?? "recipient"}.`);
      } else if (res.status.startsWith("skipped")) {
        toast.warning(`Test recorded but not delivered: ${res.status.replace(/_/g, " ")}`, {
          description: res.error,
        });
      } else {
        toast.error("Test send failed.", { description: res.error });
      }
      queryClient.invalidateQueries({ queryKey: ["admin", "membership-email-notifications"] });
    },
    onError: (err) => {
      toast.error("Test send failed.", {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const [selectedMembership, setSelectedMembership] = useState<string>("");
  const [recipientOverride, setRecipientOverride] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [drawerRow, setDrawerRow] = useState<MembershipEmailNotification | null>(null);

  const rows = notificationsQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (!q) return true;
      return (
        r.recipient_email.toLowerCase().includes(q) ||
        (r.membership_number ?? "").toLowerCase().includes(q) ||
        (r.message_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filterStatus, search]);

  const totals = useMemo(() => {
    const t = { total: rows.length, sent: 0, failed: 0, pending: 0, skipped: 0 };
    for (const r of rows) {
      if (r.status === "sent") t.sent++;
      else if (r.status === "failed") t.failed++;
      else if (r.status === "pending") t.pending++;
      else if (r.status.startsWith("skipped")) t.skipped++;
    }
    return t;
  }, [rows]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="h-6 w-6" /> Membership Activation Emails
        </h1>
        <p className="text-muted-foreground text-sm">
          Delivery log for every <code>membership-activated</code> email. Auto-refreshes every 15s.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="Total" value={totals.total} />
        <StatCard label="Sent" value={totals.sent} tone="green" />
        <StatCard label="Pending" value={totals.pending} tone="blue" />
        <StatCard label="Failed" value={totals.failed} tone="red" />
        <StatCard label="Skipped" value={totals.skipped} tone="yellow" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Send className="h-5 w-5" /> Send a delivery test
          </CardTitle>
          <CardDescription>
            Re-renders and dispatches the membership-activated email for an existing
            membership. Recorded below with <Badge variant="outline">test</Badge> so
            it never collides with real webhook idempotency.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr,1fr,auto] md:items-end">
          <div className="space-y-1">
            <Label>Membership</Label>
            <Select value={selectedMembership} onValueChange={setSelectedMembership}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a membership…" />
              </SelectTrigger>
              <SelectContent>
                {(membershipsQuery.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.membership_number} — {m.customer_name ?? m.customer_email ?? "unknown"} ({m.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Recipient override (optional)</Label>
            <Input
              type="email"
              placeholder="your.address@example.com"
              value={recipientOverride}
              onChange={(e) => setRecipientOverride(e.target.value)}
            />
          </div>
          <Button
            disabled={!selectedMembership || testMutation.isPending}
            onClick={() =>
              testMutation.mutate({
                membershipId: selectedMembership,
                recipientEmail: recipientOverride.trim() || undefined,
              })
            }
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send test
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-lg">Delivery log</CardTitle>
            <CardDescription>Most recent 200 attempts. Click a row for details.</CardDescription>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search email / membership # / message id"
                className="pl-8 md:w-72"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="md:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped_no_email_infra">Skipped: no infra</SelectItem>
                <SelectItem value="skipped_no_recipient">Skipped: no recipient</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {notificationsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading log…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No email attempts recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message ID</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setDrawerRow(r)}
                  >
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.membership_number ?? r.membership_id?.slice(0, 8) ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{r.recipient_email}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="font-mono text-xs max-w-[220px] truncate">
                      {r.message_id ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.is_test ? (
                        <Badge variant="outline">test</Badge>
                      ) : (
                        <Badge variant="secondary">webhook</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!drawerRow} onOpenChange={(open) => !open && setDrawerRow(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {drawerRow ? (
            <>
              <SheetHeader>
                <SheetTitle>Email attempt</SheetTitle>
                <SheetDescription>
                  {new Date(drawerRow.created_at).toLocaleString()}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 mt-4 text-sm">
                <Field label="Status"><StatusBadge status={drawerRow.status} /></Field>
                <Field label="Recipient">{drawerRow.recipient_email}</Field>
                <Field label="Subject">{drawerRow.subject ?? "—"}</Field>
                <Field label="Template">{drawerRow.template_name}</Field>
                <Field label="Membership number">
                  {drawerRow.membership_number ?? "—"}
                </Field>
                <Field label="Message ID">
                  <span className="font-mono text-xs break-all">{drawerRow.message_id ?? "—"}</span>
                </Field>
                <Field label="Payment ID">
                  <span className="font-mono text-xs break-all">{drawerRow.payment_id ?? "—"}</span>
                </Field>
                <Field label="Is test">{drawerRow.is_test ? "Yes" : "No"}</Field>
                {drawerRow.error_message ? (
                  <Field label="Error">
                    <div className="text-red-600 whitespace-pre-wrap text-xs">
                      {drawerRow.error_message}
                    </div>
                  </Field>
                ) : null}
                {drawerRow.metadata ? (
                  <Field label="Metadata">
                    <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(drawerRow.metadata), null, 2);
                        } catch {
                          return drawerRow.metadata;
                        }
                      })()}
                    </pre>
                  </Field>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "red" | "yellow" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-600"
      : tone === "red"
      ? "text-red-600"
      : tone === "yellow"
      ? "text-yellow-600"
      : tone === "blue"
      ? "text-blue-600"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
