import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  KeyRound,
  Mail,
  MoreHorizontal,
  Search,
  ShieldBan,
  ShieldCheck,
  Trash2,
  Copy,
  Check,
  Eye,
  Link2,
  UserCheck,
  UserX,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  deleteUser,
  generateTemporaryPassword,
  listAllUsers,
  sendPasswordResetEmail,
  setUserBan,
  type AdminUserRow,
} from "@/lib/user-admin.functions";
import { setKycDecision } from "@/lib/kyc.functions";
import { UserProfileDrawer } from "@/components/admin/UserProfileDrawer";

export type UsersRoleFilter = "customer" | "promoter" | null;

type ActionKind =
  | "reset"
  | "generate"
  | "revoke"
  | "restore"
  | "delete"
  | "approve"
  | "reject";

type TabKey = "all" | "promoter" | "customer" | "admin";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "customer", label: "Customers" },
  { key: "promoter", label: "Promoters" },
  { key: "admin", label: "Admins" },
];

export type UsersManagementTableProps = {
  /** When set, restricts the table to that role and hides tab switcher. */
  roleFilter?: UsersRoleFilter;
  /** Optional card title override. */
  title?: string;
  /** Optional search placeholder. */
  searchPlaceholder?: string;
};

export function UsersManagementTable({
  roleFilter = null,
  title,
  searchPlaceholder = "Search name, email, phone, ID, code…",
}: UsersManagementTableProps) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllUsers);
  const resetFn = useServerFn(sendPasswordResetEmail);
  const generateFn = useServerFn(generateTemporaryPassword);
  const banFn = useServerFn(setUserBan);
  const deleteFn = useServerFn(deleteUser);
  const kycFn = useServerFn(setKycDecision);

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => listFn() as Promise<AdminUserRow[]>,
  });

  const [tab, setTab] = useState<TabKey>(roleFilter ?? "all");
  const [q, setQ] = useState("");
  const [action, setAction] = useState<{ kind: ActionKind; user: AdminUserRow } | null>(null);
  const [generated, setGenerated] = useState<{ password: string; email: string | null } | null>(null);
  const [viewUserId, setViewUserId] = useState<string | null>(null);

  const scoped = useMemo(
    () => (roleFilter ? users.filter((u) => u.role === roleFilter) : users),
    [users, roleFilter],
  );

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { all: scoped.length, customer: 0, promoter: 0, admin: 0 };
    for (const u of scoped) if (u.role) c[u.role as TabKey]++;
    return c;
  }, [scoped]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scoped.filter((u) => {
      if (!roleFilter && tab !== "all" && u.role !== tab) return false;
      if (!term) return true;
      return (
        (u.email ?? "").toLowerCase().includes(term) ||
        (u.full_name ?? "").toLowerCase().includes(term) ||
        (u.phone ?? "").toLowerCase().includes(term) ||
        (u.membership_number ?? "").toLowerCase().includes(term) ||
        String(u.customer_display_id ?? "").includes(term) ||
        (u.promoter_display_id ?? "").includes(term) ||
        (u.promoter_referral_code ?? "").toLowerCase().includes(term)
      );
    });
  }, [scoped, q, tab, roleFilter]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const resetMut = useMutation({
    mutationFn: (v: { userId: string; reason: string }) => resetFn({ data: v }),
    onSuccess: (r: any) => { toast.success(`Reset email sent to ${r.sentTo}`); setAction(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const generateMut = useMutation({
    mutationFn: (v: { userId: string; reason: string }) => generateFn({ data: v }),
    onSuccess: (r: any) => {
      setGenerated({ password: r.password, email: r.email });
      setAction(null);
      toast.success("Temporary password generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const banMut = useMutation({
    mutationFn: (v: { userId: string; banned: boolean; reason: string }) => banFn({ data: v }),
    onSuccess: () => { toast.success("Access updated"); setAction(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (v: { userId: string; reason: string }) => deleteFn({ data: v }),
    onSuccess: () => { toast.success("User removed"); setAction(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const kycMut = useMutation({
    mutationFn: (v: { userId: string; approve: boolean; notes?: string; assignRole?: "customer" | "promoter" | null }) =>
      kycFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.approve ? "KYC approved" : "KYC rejected");
      setAction(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyReferralLink = async (code: string) => {
    const url = `${window.location.origin}/auth?portal=customer&mode=signup&ref=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Referral link copied");
    } catch { toast.error("Copy failed"); }
  };

  const resolvedTitle = title ?? `Users (${scoped.length})`;

  return (
    <>
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{resolvedTitle}</CardTitle>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={searchPlaceholder}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          {!roleFilter && (
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
              <TabsList>
                {TABS.map((t) => (
                  <TabsTrigger key={t.key} value={t.key}>
                    {t.label} <span className="ml-1.5 text-xs text-muted-foreground">({counts[t.key]})</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="text-sm text-destructive">Failed to load users: {(error as Error).message}</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No users match.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Member ID</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => {
                    const banned = !!u.banned_until && new Date(u.banned_until).getTime() > Date.now();
                    const displayId =
                      u.role === "promoter"
                        ? (u.promoter_display_id ?? "—")
                        : u.role === "customer"
                          ? (u.customer_display_id != null ? String(u.customer_display_id) : "—")
                          : "—";
                    const canApprove = u.kyc_status === "pending" || u.kyc_status === "rejected";
                    const canReject = u.kyc_status === "pending" || u.kyc_status === "approved";
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono text-xs">{displayId}</TableCell>
                        <TableCell className="font-medium">
                          {u.full_name || <span className="text-muted-foreground">—</span>}
                          {u.phone && (
                            <div className="text-xs text-muted-foreground">{u.phone}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{u.email}</TableCell>
                        <TableCell>
                          {u.role ? (
                            <Badge variant={u.role === "admin" ? "default" : "secondary"} className="capitalize">
                              {u.role}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.membership_number || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {banned ? (
                            <Badge variant="destructive">Revoked</Badge>
                          ) : u.kyc_status === "approved" ? (
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                              KYC approved
                            </Badge>
                          ) : u.kyc_status === "rejected" ? (
                            <Badge variant="outline" className="border-destructive/40 text-destructive">
                              KYC rejected
                            </Badge>
                          ) : u.kyc_status === "pending" ? (
                            <Badge variant="outline">KYC pending</Badge>
                          ) : (
                            <Badge variant="outline">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {u.role === "promoter" && u.promoter_referral_code && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Copy referral link"
                                onClick={() => copyReferralLink(u.promoter_referral_code!)}
                              >
                                <Link2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              title="View / edit profile"
                              onClick={() => setViewUserId(u.id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setViewUserId(u.id)}>
                                  <Eye className="mr-2 h-4 w-4" /> View / edit profile
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {u.role !== "admin" && canApprove && (
                                  <DropdownMenuItem onClick={() => setAction({ kind: "approve", user: u })}>
                                    <UserCheck className="mr-2 h-4 w-4" /> Approve KYC
                                  </DropdownMenuItem>
                                )}
                                {u.role !== "admin" && canReject && (
                                  <DropdownMenuItem onClick={() => setAction({ kind: "reject", user: u })}>
                                    <UserX className="mr-2 h-4 w-4" /> Reject KYC
                                  </DropdownMenuItem>
                                )}
                                {u.role !== "admin" && (canApprove || canReject) && <DropdownMenuSeparator />}
                                <DropdownMenuItem onClick={() => setAction({ kind: "reset", user: u })}>
                                  <Mail className="mr-2 h-4 w-4" /> Send reset email
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setAction({ kind: "generate", user: u })}>
                                  <KeyRound className="mr-2 h-4 w-4" /> Generate password
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {banned ? (
                                  <DropdownMenuItem onClick={() => setAction({ kind: "restore", user: u })}>
                                    <ShieldCheck className="mr-2 h-4 w-4" /> Restore access
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => setAction({ kind: "revoke", user: u })}>
                                    <ShieldBan className="mr-2 h-4 w-4" /> Disable / revoke access
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setAction({ kind: "delete", user: u })}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Remove user
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ActionDialog
        action={action}
        onClose={() => setAction(null)}
        onConfirm={(reason) => {
          if (!action) return;
          const payload = { userId: action.user.id, reason };
          if (action.kind === "reset") resetMut.mutate(payload);
          else if (action.kind === "generate") generateMut.mutate(payload);
          else if (action.kind === "revoke") banMut.mutate({ ...payload, banned: true });
          else if (action.kind === "restore") banMut.mutate({ ...payload, banned: false });
          else if (action.kind === "delete") deleteMut.mutate(payload);
          else if (action.kind === "approve") {
            // Preserve or set the role: use the row's current role when it's
            // customer/promoter; otherwise fall back to the page's role filter,
            // and finally to "customer" as a safe default.
            const roleForApproval =
              action.user.role === "promoter" || action.user.role === "customer"
                ? action.user.role
                : (roleFilter ?? "customer");
            kycMut.mutate({
              userId: action.user.id,
              approve: true,
              notes: reason,
              assignRole: roleForApproval,
            });
          } else if (action.kind === "reject") {
            kycMut.mutate({
              userId: action.user.id,
              approve: false,
              notes: reason,
              assignRole: null,
            });
          }
        }}
        pending={
          resetMut.isPending ||
          generateMut.isPending ||
          banMut.isPending ||
          deleteMut.isPending ||
          kycMut.isPending
        }
      />

      <GeneratedPasswordDialog data={generated} onClose={() => setGenerated(null)} />
      <UserProfileDrawer userId={viewUserId} onClose={() => setViewUserId(null)} />
    </>
  );
}

const ACTION_LABELS: Record<ActionKind, { title: string; desc: string; cta: string; danger?: boolean; success?: boolean }> = {
  reset: { title: "Send password reset email", desc: "The user receives an email with a link to set a new password.", cta: "Send email" },
  generate: { title: "Generate a temporary password", desc: "A strong random password is created and shown once.", cta: "Generate password" },
  revoke: { title: "Disable / revoke access", desc: "The user is signed out of all sessions and blocked from signing in until restored.", cta: "Revoke access", danger: true },
  restore: { title: "Restore access", desc: "The user will be able to sign in again immediately.", cta: "Restore access", success: true },
  delete: { title: "Remove user permanently", desc: "Deletes the user account, profile, and role assignments. Cannot be undone.", cta: "Delete user", danger: true },
  approve: { title: "Approve KYC", desc: "Approves the user's KYC and assigns their membership role.", cta: "Approve", success: true },
  reject: { title: "Reject KYC", desc: "Marks the user's KYC as rejected. The user can resubmit updated documents.", cta: "Reject", danger: true },
};

function ActionDialog({
  action, onClose, onConfirm, pending,
}: {
  action: { kind: ActionKind; user: AdminUserRow } | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const meta = action ? ACTION_LABELS[action.kind] : null;

  return (
    <Dialog open={!!action} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent>
        {meta && action && (
          <>
            <DialogHeader>
              <DialogTitle>{meta.title}</DialogTitle>
              <DialogDescription>
                For <span className="font-mono">{action.user.email}</span>
                <br />{meta.desc}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="reason">
                {action.kind === "approve" || action.kind === "reject" ? "Reviewer notes" : "Reason"}
              </Label>
              <Textarea
                id="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you doing this? (min 5 characters, saved in audit log)"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setReason(""); onClose(); }}>Cancel</Button>
              <Button
                variant={meta.danger ? "destructive" : meta.success ? "success" : "default"}
                disabled={pending || reason.trim().length < 5}
                onClick={() => onConfirm(reason.trim())}
              >
                {pending ? "Working…" : meta.cta}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GeneratedPasswordDialog({
  data, onClose,
}: { data: { password: string; email: string | null } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={!!data} onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with the user through a secure channel. Shown only once.
          </DialogDescription>
        </DialogHeader>
        {data && (
          <div className="space-y-3">
            {data.email && (
              <div className="text-sm text-muted-foreground">
                Account: <span className="font-mono">{data.email}</span>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
              <code className="flex-1 select-all break-all font-mono text-sm">{data.password}</code>
              <Button size="sm" variant="outline" onClick={async () => {
                try { await navigator.clipboard.writeText(data.password); setCopied(true); toast.success("Copied to clipboard"); }
                catch { toast.error("Copy failed"); }
              }}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
