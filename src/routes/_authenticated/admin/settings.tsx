import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, UserPlus, AlertTriangle, Loader2, Trash2, History, ShieldAlert, X } from "lucide-react";
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
import { useSession, useCurrentRole } from "@/lib/auth";
import {
  claimFirstAdmin,
  getAdminBootstrapStatus,
  listAdmins,
  listAdminAuditLog,
  promoteToAdminByEmail,
  setUserRole,
} from "@/lib/admin.functions";



export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Admin Access — Arasi Enterprises" }] }),
  component: AdminSettings,
});

function AdminSettings() {
  const { user } = useSession();
  const { data: role, isLoading: roleLoading } = useCurrentRole(user);

  const bootstrapFn = useServerFn(getAdminBootstrapStatus);
  const claimFn = useServerFn(claimFirstAdmin);
  const listFn = useServerFn(listAdmins);
  const auditFn = useServerFn(listAdminAuditLog);
  const promoteFn = useServerFn(promoteToAdminByEmail);
  const demoteFn = useServerFn(setUserRole);
  const queryClient = useQueryClient();

  const [promoteReason, setPromoteReason] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<null | {
    userId: string;
    email: string | null;
    fullName: string | null;
    isSelf: boolean;
  }>(null);
  const [revokeReason, setRevokeReason] = useState("");

  // Audit log filters
  const [fActor, setFActor] = useState("");
  const [fTarget, setFTarget] = useState("");
  const [fRole, setFRole] = useState<string>("all");
  const [fAction, setFAction] = useState<string>("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");



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
          onSubmit={(e) => {
            e.preventDefault();
            const value = email.trim().toLowerCase();
            if (!value) return;
            promote.mutate({ email: value, reason: promoteReason.trim() || undefined });
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
            <Label htmlFor="promote-reason" className="text-xs">Reason (recorded in audit log)</Label>
            <Textarea
              id="promote-reason"
              rows={2}
              maxLength={500}
              placeholder="e.g. Onboarding new operations lead"
              value={promoteReason}
              onChange={(e) => setPromoteReason(e.target.value)}
              disabled={promote.isPending}
            />
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
              Reason (recorded in audit log)
            </Label>
            <Textarea
              id="revoke-reason"
              rows={3}
              maxLength={500}
              placeholder="e.g. Employee departed — access no longer required"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              disabled={demote.isPending}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={demote.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={demote.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!revokeTarget) return;
                demote.mutate({
                  userId: revokeTarget.userId,
                  reason: revokeReason.trim() || undefined,
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
                <div className="flex items-end justify-between gap-2 sm:col-span-2 lg:col-span-6">
                  <div className="text-xs text-muted-foreground">
                    Showing <span className="font-medium text-foreground">{filtered.length}</span> of {rows.length} entries
                  </div>
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
                            <tr key={row.id} className="align-top">
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
                                {row.reason || <span className="italic opacity-60">—</span>}
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
    </div>
  );
}

