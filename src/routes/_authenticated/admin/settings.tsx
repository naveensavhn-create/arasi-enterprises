import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, UserPlus, AlertTriangle, Loader2, Trash2, History } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
      toast.success("Admin role revoked.");
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const value = email.trim().toLowerCase();
            if (!value) return;
            promote.mutate(value);
          }}
        >
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

        <div className="mt-4 divide-y divide-border rounded-lg border border-border">
          {admins.isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {admins.data?.map((a) => {
            const isSelf = a.userId === user?.id;
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
                  </div>
                  {a.email && a.fullName && (
                    <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                  )}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Granted {new Date(a.grantedAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={demote.isPending}
                  onClick={() => {
                    if (
                      confirm(
                        isSelf
                          ? "Remove admin from your own account? You'll lose access to admin tools."
                          : `Revoke admin role from ${a.email ?? a.userId}?`,
                      )
                    ) {
                      demote.mutate(a.userId);
                    }
                  }}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Revoke
                </Button>
              </div>
            );
          })}
          {admins.data && admins.data.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No administrators yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
