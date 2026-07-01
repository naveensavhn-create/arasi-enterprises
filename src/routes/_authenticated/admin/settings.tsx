import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, UserPlus, AlertTriangle, Loader2, Trash2, History, ShieldAlert, X, Download, Eye, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSession, useCurrentRole } from "@/lib/auth";
import {
  claimFirstAdmin,
  getAdminBootstrapStatus,
  listAdmins,
  listAdminAuditLog,
  listRoleEmailNotifications,
  promoteToAdminByEmail,
  sendRoleChangeTestEmail,
  setUserRole,
  type RoleEmailNotification,
} from "@/lib/admin.functions";
import { Mail, Send, CheckCircle2, XCircle, Clock } from "lucide-react";



export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Admin Access — Arasi Enterprises" }] }),
  component: AdminSettings,
});

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  role_before: string | null;
  role_after: string | null;
  reason: string | null;
  metadata?: unknown;
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Escape quotes; wrap in quotes if contains comma, quote, newline, or leading/trailing space
  if (/[",\n\r]|^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportAuditCsv(
  rows: AuditRow[],
  filters: { actor: string; target: string; role: string; action: string; from: string; to: string },
) {
  const headers = [
    "timestamp_iso", "timestamp_local", "action",
    "actor_email", "actor_id",
    "target_email", "target_user_id",
    "role_before", "role_after", "reason",
  ];
  const lines: string[] = [];
  // Metadata comment rows (Excel treats leading # as text)
  lines.push(`# Arasi Enterprises — Admin audit log export`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(
    `# Filters: actor=${filters.actor || "-"}, target=${filters.target || "-"}, role=${filters.role}, action=${filters.action}, from=${filters.from || "-"}, to=${filters.to || "-"}`,
  );
  lines.push(`# Rows: ${rows.length}`);
  lines.push(headers.join(","));
  for (const r of rows) {
    lines.push([
      r.created_at,
      new Date(r.created_at).toLocaleString(),
      r.action,
      r.actor_email,
      r.actor_id,
      r.target_email,
      r.target_user_id,
      r.role_before,
      r.role_after,
      r.reason,
    ].map(csvCell).join(","));
  }
  const csv = "\ufeff" + lines.join("\r\n"); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `arasi-admin-audit-log_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AdminSettings() {
  const { user } = useSession();
  const { data: role, isLoading: roleLoading } = useCurrentRole(user);

  const bootstrapFn = useServerFn(getAdminBootstrapStatus);
  const claimFn = useServerFn(claimFirstAdmin);
  const listFn = useServerFn(listAdmins);
  const auditFn = useServerFn(listAdminAuditLog);
  const promoteFn = useServerFn(promoteToAdminByEmail);
  const demoteFn = useServerFn(setUserRole);
  const notificationsFn = useServerFn(listRoleEmailNotifications);
  const testEmailFn = useServerFn(sendRoleChangeTestEmail);
  const queryClient = useQueryClient();

  const [testKind, setTestKind] = useState<"promote" | "revoke">("promote");
  const [testEmail, setTestEmail] = useState("");
  const [promoteReason, setPromoteReason] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<null | {
    userId: string;
    email: string | null;
    fullName: string | null;
    isSelf: boolean;
  }>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [promoteReasonError, setPromoteReasonError] = useState<string | null>(null);
  const [revokeReasonError, setRevokeReasonError] = useState<string | null>(null);
  const REASON_MIN = 5;

  // Audit log filters
  const [fActor, setFActor] = useState("");
  const [fTarget, setFTarget] = useState("");
  const [fRole, setFRole] = useState<string>("all");
  const [fAction, setFAction] = useState<string>("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [selectedAudit, setSelectedAudit] = useState<AuditRow | null>(null);



  const bootstrap = useQuery({
    queryKey: ["admin-bootstrap"],
    queryFn: () => bootstrapFn(),
  });

  const admins = useQuery({
    queryKey: ["admin-list"],
    queryFn: () => listFn(),
    enabled: role === "admin",
  });

  const audit = useQuery({
    queryKey: ["admin-audit-log"],
    queryFn: () => auditFn(),
    enabled: role === "admin",
  });

  const notifications = useQuery({
    queryKey: ["role-email-notifications"],
    queryFn: () => notificationsFn(),
    enabled: role === "admin",
    refetchInterval: 15_000,
  });

  const sendTest = useMutation({
    mutationFn: (vars: { kind: "promote" | "revoke"; recipientEmail?: string }) =>
      testEmailFn({ data: vars }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["role-email-notifications"] });
      if (res.status === "sent") {
        toast.success("Test email sent", { description: `Message ID: ${res.logId}` });
      } else if (res.status === "skipped_no_email_infra") {
        toast.warning("Logged but not delivered", {
          description:
            "Set up a sender domain in Cloud → Emails to activate live sending. The attempt is recorded below.",
          duration: 8000,
        });
      } else {
        toast.error("Test send failed", { description: res.error ?? res.status });
      }
    },
    onError: (e: Error) => toast.error("Test send failed", { description: e.message }),

  const claim = useMutation({
    mutationFn: () => claimFn(),
    onSuccess: () => {
      toast.success("You are now an administrator.");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [email, setEmail] = useState("");
  const promote = useMutation({
    mutationFn: (vars: { email: string; reason?: string }) =>
      promoteFn({ data: vars }),
    onSuccess: () => {
      toast.success(`Promoted ${email} to admin.`);
      setEmail("");
      setPromoteReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const demote = useMutation({
    mutationFn: (vars: { userId: string; reason?: string }) =>
      demoteFn({ data: { userId: vars.userId, role: "customer", reason: vars.reason } }),
    onSuccess: () => {
      toast.success("Admin role revoked.", {
        description: revokeTarget?.isSelf
          ? "You have lost access to admin tools."
          : `${revokeTarget?.email ?? "The account"} is now a customer.`,
      });
      setRevokeTarget(null);
      setRevokeReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] });
    },
    onError: (e: Error) => {
      if (e.message.startsWith("LAST_ADMIN:")) {
        toast.error("Cannot revoke the last administrator", {
          description: e.message.replace(/^LAST_ADMIN:\s*/, ""),
          duration: 8000,
        });
      } else {
        toast.error("Revoke failed", { description: e.message });
      }
    },
  });



  if (roleLoading || bootstrap.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading admin access…
        </div>
      </div>
    );
  }

  const hasAdmin = bootstrap.data?.hasAdmin ?? false;

  // No admin exists yet — offer bootstrap claim to any signed-in user.
  if (!hasAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-lg"
              style={{ background: "var(--gradient-gold-value)", color: "var(--navy)" }}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Bootstrap administrator</h1>
              <p className="text-xs text-muted-foreground">
                No admin exists yet. The first authenticated user may claim this role — one time
                only.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">
            You are signed in as <span className="font-medium">{user?.email ?? user?.phone}</span>.
            Clicking below grants your account the admin role. All subsequent promotions require an
            existing admin.
          </div>

          <Button
            className="mt-6 w-full"
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
          >
            {claim.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Claiming…</>
            ) : (
              <>Claim admin role</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Admin exists but caller is not one.
  if (role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 h-5 w-5 text-amber-500" />
            <div>
              <h1 className="text-lg font-semibold">Admin access required</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask an existing administrator to promote your account
                {user?.email ? ` (${user.email})` : ""}.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <UserPlus className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Promote user to admin</h1>
            <p className="text-xs text-muted-foreground">
              The user must already have signed up. Enter their account email.
            </p>
          </div>
        </div>

        <form
          className="mt-5 space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const value = email.trim().toLowerCase();
            const reason = promoteReason.trim();
            if (!value) return;
            if (reason.length < REASON_MIN) {
              setPromoteReasonError(
                reason.length === 0
                  ? "Reason is required — this action is recorded in the audit log."
                  : `Please provide at least ${REASON_MIN} characters (currently ${reason.length}).`,
              );
              document.getElementById("promote-reason")?.focus();
              return;
            }
            setPromoteReasonError(null);
            promote.mutate({ email: value, reason });
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="promote-email" className="text-xs">Email address</Label>
              <Input
                id="promote-email"
                type="email"
                autoComplete="email"
                required
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={promote.isPending}
              />
            </div>
            <Button type="submit" disabled={promote.isPending || !email.trim()}>
              {promote.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Promoting…</>
              ) : (
                <>Grant admin</>
              )}
            </Button>
          </div>
          <div>
            <Label htmlFor="promote-reason" className="text-xs">
              Reason <span className="text-destructive">*</span>{" "}
              <span className="text-muted-foreground">(recorded in audit log)</span>
            </Label>
            <Textarea
              id="promote-reason"
              rows={2}
              maxLength={500}
              required
              aria-invalid={!!promoteReasonError}
              aria-describedby={promoteReasonError ? "promote-reason-error" : undefined}
              className={promoteReasonError ? "border-destructive focus-visible:ring-destructive" : ""}
              placeholder="e.g. Onboarding new operations lead"
              value={promoteReason}
              onChange={(e) => {
                setPromoteReason(e.target.value);
                if (promoteReasonError && e.target.value.trim().length >= REASON_MIN) {
                  setPromoteReasonError(null);
                }
              }}
              disabled={promote.isPending}
            />
            {promoteReasonError ? (
              <p id="promote-reason-error" role="alert" className="mt-1 text-xs text-destructive">
                {promoteReasonError}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Minimum {REASON_MIN} characters. {Math.max(0, REASON_MIN - promoteReason.trim().length)} to go.
              </p>
            )}
          </div>
        </form>
      </div>



      <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Current administrators</h2>
            <p className="text-xs text-muted-foreground">
              {admins.data?.length ?? 0} account{(admins.data?.length ?? 0) === 1 ? "" : "s"} with
              admin role.
            </p>
          </div>
        </div>

        {admins.data && admins.data.length === 1 && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Only one administrator remains.</div>
              <div className="mt-0.5 opacity-90">
                Revoking this account is blocked until you promote another user to admin.
                This protects the system from becoming locked out.
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 divide-y divide-border rounded-lg border border-border">
          {admins.isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {admins.data?.map((a) => {
            const isSelf = a.userId === user?.id;
            const isLastAdmin = (admins.data?.length ?? 0) <= 1;
            const revokeBtn = (
              <Button
                variant="outline"
                size="sm"
                disabled={demote.isPending || isLastAdmin}
                onClick={() => {
                  setRevokeReason("");
                  setRevokeTarget({
                    userId: a.userId,
                    email: a.email,
                    fullName: a.fullName,
                    isSelf,
                  });
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Revoke
              </Button>
            );
            return (
              <div key={a.userId} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {a.fullName || a.email || a.userId}
                    {isSelf && (
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                        You
                      </span>
                    )}
                    {isLastAdmin && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Last admin
                      </span>
                    )}
                  </div>
                  {a.email && a.fullName && (
                    <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                  )}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Granted {new Date(a.grantedAt).toLocaleDateString()}
                  </div>
                </div>
                {isLastAdmin ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>{revokeBtn}</span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                      Promote another user to admin first — the system requires at least one
                      administrator.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  revokeBtn
                )}
              </div>
            );
          })}
          {admins.data && admins.data.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No administrators yet.</div>
          )}
        </div>
      </div>

      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open && !demote.isPending) {
            setRevokeTarget(null);
            setRevokeReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Revoke admin access?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  This will remove the admin role from{" "}
                  <span className="font-medium text-foreground">
                    {revokeTarget?.fullName || revokeTarget?.email || revokeTarget?.userId}
                  </span>
                  {revokeTarget?.isSelf ? " (your own account)" : ""} and downgrade them to{" "}
                  <span className="font-medium text-foreground">customer</span>.
                </div>
                {revokeTarget?.isSelf && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                    You will immediately lose access to every admin tool. Another admin will need
                    to restore your role.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="revoke-reason" className="text-xs">
              Reason <span className="text-destructive">*</span>{" "}
              <span className="text-muted-foreground">(recorded in audit log)</span>
            </Label>
            <Textarea
              id="revoke-reason"
              rows={3}
              maxLength={500}
              required
              aria-invalid={!!revokeReasonError}
              aria-describedby={revokeReasonError ? "revoke-reason-error" : undefined}
              className={revokeReasonError ? "border-destructive focus-visible:ring-destructive" : ""}
              placeholder="e.g. Employee departed — access no longer required"
              value={revokeReason}
              onChange={(e) => {
                setRevokeReason(e.target.value);
                if (revokeReasonError && e.target.value.trim().length >= REASON_MIN) {
                  setRevokeReasonError(null);
                }
              }}
              disabled={demote.isPending}
            />
            {revokeReasonError ? (
              <p id="revoke-reason-error" role="alert" className="text-xs text-destructive">
                {revokeReasonError}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Minimum {REASON_MIN} characters. {Math.max(0, REASON_MIN - revokeReason.trim().length)} to go.
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={demote.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={demote.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!revokeTarget) return;
                const reason = revokeReason.trim();
                if (reason.length < REASON_MIN) {
                  setRevokeReasonError(
                    reason.length === 0
                      ? "Reason is required — this action is recorded in the audit log."
                      : `Please provide at least ${REASON_MIN} characters (currently ${reason.length}).`,
                  );
                  document.getElementById("revoke-reason")?.focus();
                  return;
                }
                setRevokeReasonError(null);
                demote.mutate({
                  userId: revokeTarget.userId,
                  reason,
                });
              }}
            >
              {demote.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Revoking…</>
              ) : (
                "Revoke admin"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <History className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Role change audit log</h2>
            <p className="text-xs text-muted-foreground">
              Every promote and revoke is recorded here with actor, target, timestamp, and reason.
            </p>
          </div>
        </div>

        {(() => {
          const rows = audit.data ?? [];
          const filtered = rows.filter((r) => {
            if (fActor.trim()) {
              const hay = `${r.actor_email ?? ""} ${r.actor_id ?? ""}`.toLowerCase();
              if (!hay.includes(fActor.trim().toLowerCase())) return false;
            }
            if (fTarget.trim()) {
              const hay = `${r.target_email ?? ""} ${r.target_user_id ?? ""}`.toLowerCase();
              if (!hay.includes(fTarget.trim().toLowerCase())) return false;
            }
            if (fRole !== "all") {
              if (r.role_before !== fRole && r.role_after !== fRole) return false;
            }
            if (fAction !== "all" && r.action !== fAction) return false;
            if (fFrom) {
              const from = new Date(fFrom + "T00:00:00").getTime();
              if (new Date(r.created_at).getTime() < from) return false;
            }
            if (fTo) {
              const to = new Date(fTo + "T23:59:59.999").getTime();
              if (new Date(r.created_at).getTime() > to) return false;
            }
            return true;
          });
          const hasFilters =
            fActor || fTarget || fRole !== "all" || fAction !== "all" || fFrom || fTo;

          return (
            <>
              <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="space-y-1">
                  <Label htmlFor="f-actor" className="text-[10px] uppercase tracking-wider text-muted-foreground">Actor</Label>
                  <Input id="f-actor" placeholder="email or id" value={fActor} onChange={(e) => setFActor(e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-target" className="text-[10px] uppercase tracking-wider text-muted-foreground">Target</Label>
                  <Input id="f-target" placeholder="email or id" value={fTarget} onChange={(e) => setFTarget(e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Role changed</Label>
                  <Select value={fRole} onValueChange={setFRole}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any role</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="promoter">promoter</SelectItem>
                      <SelectItem value="customer">customer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</Label>
                  <Select value={fAction} onValueChange={setFAction}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any action</SelectItem>
                      <SelectItem value="promote">promote</SelectItem>
                      <SelectItem value="revoke">revoke</SelectItem>
                      <SelectItem value="bootstrap_claim">bootstrap claim</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-from" className="text-[10px] uppercase tracking-wider text-muted-foreground">From</Label>
                  <Input id="f-from" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-to" className="text-[10px] uppercase tracking-wider text-muted-foreground">To</Label>
                  <Input id="f-to" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="h-8" />
                </div>
                <div className="flex flex-wrap items-end justify-between gap-2 sm:col-span-2 lg:col-span-6">
                  <div className="text-xs text-muted-foreground">
                    Showing <span className="font-medium text-foreground">{filtered.length}</span> of {rows.length} entries
                  </div>
                  <div className="flex items-center gap-2">
                    {hasFilters && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFActor(""); setFTarget(""); setFRole("all");
                          setFAction("all"); setFFrom(""); setFTo("");
                        }}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Clear filters
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={filtered.length === 0}
                      onClick={() => exportAuditCsv(filtered, {
                        actor: fActor, target: fTarget, role: fRole,
                        action: fAction, from: fFrom, to: fTo,
                      })}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" />
                      Export CSV{hasFilters ? ` (${filtered.length})` : ""}
                    </Button>
                  </div>
                </div>

              </div>

              <div className="mt-4 overflow-hidden rounded-lg border border-border">
                {audit.isLoading && (
                  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading audit log…
                  </div>
                )}
                {!audit.isLoading && rows.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No role changes recorded yet.</div>
                )}
                {!audit.isLoading && rows.length > 0 && filtered.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No entries match the current filters.</div>
                )}
                {filtered.length > 0 && (
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">When</th>
                          <th className="px-3 py-2 font-medium">Action</th>
                          <th className="px-3 py-2 font-medium">Target</th>
                          <th className="px-3 py-2 font-medium">Change</th>
                          <th className="px-3 py-2 font-medium">Actor</th>
                          <th className="px-3 py-2 font-medium">Reason</th>
                          <th className="px-3 py-2 font-medium sr-only">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filtered.map((row) => {
                          const badge =
                            row.action === "promote" || row.action === "bootstrap_claim"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : row.action === "revoke"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-primary/10 text-primary";
                          return (
                            <tr
                              key={row.id}
                              className="cursor-pointer align-top hover:bg-muted/30 focus-within:bg-muted/30"
                              onClick={() => setSelectedAudit(row)}
                            >
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {new Date(row.created_at).toLocaleString()}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badge}`}>
                                  {row.action.replace("_", " ")}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs">
                                <div className="font-medium">{row.target_email ?? row.target_user_id}</div>
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {(row.role_before ?? "—")} → {(row.role_after ?? "—")}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {row.actor_email ?? row.actor_id}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                <span className="line-clamp-1 max-w-[220px]">
                                  {row.reason || <span className="italic opacity-60">—</span>}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={(e) => { e.stopPropagation(); setSelectedAudit(row); }}
                                  aria-label="View audit entry details"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </div>

      <AuditDetailsDrawer
        row={selectedAudit}
        onClose={() => setSelectedAudit(null)}
      />
    </div>
  );
}

function RoleChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const cls =
    value === "admin"
      ? "bg-primary/15 text-primary"
      : value === "promoter"
        ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
        : "bg-muted text-foreground/70";
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${cls}`}>
      {value}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function CopyableId({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => toast.success("Copied", { description: value }),
          () => toast.error("Copy failed"),
        );
      }}
      className="group inline-flex items-center gap-1.5 rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] hover:bg-muted"
      title="Copy to clipboard"
    >
      <span className="truncate max-w-[220px]">{value}</span>
      <Copy className="h-3 w-3 opacity-60 group-hover:opacity-100" />
    </button>
  );
}

function AuditDetailsDrawer({
  row,
  onClose,
}: {
  row: AuditRow | null;
  onClose: () => void;
}) {
  const open = !!row;
  const created = row ? new Date(row.created_at) : null;
  const actionLabel = row?.action.replace(/_/g, " ") ?? "";
  const actionCls =
    row?.action === "promote" || row?.action === "bootstrap_claim"
      ? "bg-emerald-500/10 text-emerald-600"
      : row?.action === "revoke"
        ? "bg-destructive/10 text-destructive"
        : "bg-primary/10 text-primary";

  const metadataString =
    row?.metadata && typeof row.metadata === "object" && Object.keys(row.metadata as object).length > 0
      ? JSON.stringify(row.metadata, null, 2)
      : null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${actionCls}`}>
              {actionLabel}
            </span>
            <SheetTitle className="text-base">Audit entry</SheetTitle>
          </div>
          <SheetDescription>
            {created ? (
              <>
                {created.toLocaleString(undefined, {
                  weekday: "short", year: "numeric", month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                })}
                <span className="ml-2 text-xs opacity-70">({created.toISOString()})</span>
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        {row && (
          <div className="mt-6 space-y-6">
            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Role change
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RoleChip value={row.role_before} />
                <span className="text-muted-foreground">→</span>
                <RoleChip value={row.role_after} />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Target</h3>
              <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
                <Field label="Email">
                  {row.target_email ?? <span className="text-muted-foreground">—</span>}
                </Field>
                <Field label="User ID">
                  <CopyableId value={row.target_user_id} />
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Actor</h3>
              <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
                <Field label="Email">
                  {row.actor_email ?? <span className="text-muted-foreground">—</span>}
                </Field>
                <Field label="User ID">
                  <CopyableId value={row.actor_id} />
                </Field>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Reason</h3>
              <div className="rounded-lg border border-border p-4 text-sm">
                {row.reason ? (
                  <p className="whitespace-pre-wrap leading-relaxed">{row.reason}</p>
                ) : (
                  <p className="italic text-muted-foreground">No reason recorded.</p>
                )}
              </div>
            </section>

            {metadataString && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Metadata</h3>
                <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
                  {metadataString}
                </pre>
              </section>
            )}

            <section className="space-y-2">
              <Field label="Entry ID">
                <CopyableId value={row.id} />
              </Field>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

