import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users — Admin" }] }),
  component: AdminUsersPage,
});

type ActionKind = "reset" | "generate" | "revoke" | "restore" | "delete";

function AdminUsersPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllUsers);
  const resetFn = useServerFn(sendPasswordResetEmail);
  const generateFn = useServerFn(generateTemporaryPassword);
  const banFn = useServerFn(setUserBan);
  const deleteFn = useServerFn(deleteUser);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => listFn() as Promise<AdminUserRow[]>,
  });

  const [q, setQ] = useState("");
  const [action, setAction] = useState<{ kind: ActionKind; user: AdminUserRow } | null>(null);
  const [generated, setGenerated] = useState<{ password: string; email: string | null } | null>(
    null,
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) =>
        (u.email ?? "").toLowerCase().includes(term) ||
        (u.full_name ?? "").toLowerCase().includes(term) ||
        (u.phone ?? "").toLowerCase().includes(term) ||
        (u.membership_number ?? "").toLowerCase().includes(term),
    );
  }, [users, q]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const resetMut = useMutation({
    mutationFn: (v: { userId: string; reason: string }) => resetFn({ data: v }),
    onSuccess: (r: any) => {
      toast.success(`Reset email sent to ${r.sentTo}`);
      setAction(null);
    },
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
    onSuccess: () => {
      toast.success("Access updated");
      setAction(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (v: { userId: string; reason: string }) => deleteFn({ data: v }),
    onSuccess: () => {
      toast.success("User removed");
      setAction(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage user accounts — reset or generate passwords, revoke, restore, or remove users.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>All users ({users.length})</CardTitle>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search email, name, phone, membership…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">No users match.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const banned =
                    !!u.banned_until && new Date(u.banned_until).getTime() > Date.now();
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.full_name || <span className="text-muted-foreground">—</span>}
                        {u.membership_number && (
                          <div className="text-xs text-muted-foreground">
                            {u.membership_number}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{u.email}</TableCell>
                      <TableCell>
                        {u.role ? (
                          <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                            {u.role}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {banned ? (
                          <Badge variant="destructive">Revoked</Badge>
                        ) : (
                          <Badge variant="outline">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setAction({ kind: "reset", user: u })}>
                              <Mail className="mr-2 h-4 w-4" /> Send reset email
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setAction({ kind: "generate", user: u })}
                            >
                              <KeyRound className="mr-2 h-4 w-4" /> Generate password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {banned ? (
                              <DropdownMenuItem
                                onClick={() => setAction({ kind: "restore", user: u })}
                              >
                                <ShieldCheck className="mr-2 h-4 w-4" /> Restore access
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => setAction({ kind: "revoke", user: u })}
                              >
                                <ShieldBan className="mr-2 h-4 w-4" /> Revoke access
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
          else if (action.kind === "revoke")
            banMut.mutate({ ...payload, banned: true });
          else if (action.kind === "restore")
            banMut.mutate({ ...payload, banned: false });
          else if (action.kind === "delete") deleteMut.mutate(payload);
        }}
        pending={
          resetMut.isPending ||
          generateMut.isPending ||
          banMut.isPending ||
          deleteMut.isPending
        }
      />

      <GeneratedPasswordDialog data={generated} onClose={() => setGenerated(null)} />
    </div>
  );
}

const ACTION_LABELS: Record<ActionKind, { title: string; desc: string; cta: string; danger?: boolean }> =
  {
    reset: {
      title: "Send password reset email",
      desc: "The user receives an email with a link to set a new password.",
      cta: "Send email",
    },
    generate: {
      title: "Generate a temporary password",
      desc: "A strong random password is created and shown once. The user should change it after signing in.",
      cta: "Generate password",
    },
    revoke: {
      title: "Revoke access",
      desc: "The user is signed out of all sessions and blocked from signing in until restored.",
      cta: "Revoke access",
      danger: true,
    },
    restore: {
      title: "Restore access",
      desc: "The user will be able to sign in again immediately.",
      cta: "Restore access",
    },
    delete: {
      title: "Remove user permanently",
      desc: "This deletes the user account, profile, and role assignments. This cannot be undone.",
      cta: "Delete user",
      danger: true,
    },
  };

function ActionDialog({
  action,
  onClose,
  onConfirm,
  pending,
}: {
  action: { kind: ActionKind; user: AdminUserRow } | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const meta = action ? ACTION_LABELS[action.kind] : null;

  return (
    <Dialog
      open={!!action}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent>
        {meta && action && (
          <>
            <DialogHeader>
              <DialogTitle>{meta.title}</DialogTitle>
              <DialogDescription>
                For <span className="font-mono">{action.user.email}</span>
                <br />
                {meta.desc}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you doing this? (min 5 characters, saved in audit log)"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant={meta.danger ? "destructive" : "default"}
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
  data,
  onClose,
}: {
  data: { password: string; email: string | null } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={!!data}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with the user through a secure channel. This is shown once — it won't be
            visible again.
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
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.password);
                    setCopied(true);
                    toast.success("Copied to clipboard");
                  } catch {
                    toast.error("Copy failed");
                  }
                }}
              >
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
