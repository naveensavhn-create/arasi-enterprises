import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Search,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ExternalLink,
  FileImage,
  MapPin,
  Phone,
  Mail,
  IdCard,
  Loader2,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  getKycSignedUrl,
  listKycSubmissions,
  setKycDecision,
  type KycProfile,
  type KycStatus,
} from "@/lib/kyc.functions";
import {
  adminListPromoters,
  adminSetCustomerPromoter,
  type PromoterOption,
} from "@/lib/promoter.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserRoundCog } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/approvals")({
  head: () => ({ meta: [{ title: "Approvals — Admin" }] }),
  component: AdminApprovalsPage,
});

function statusBadge(s: KycStatus) {
  if (s === "approved")
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">
        <ShieldCheck className="mr-1 h-3 w-3" /> Approved
      </Badge>
    );
  if (s === "pending")
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500">
        <Clock className="mr-1 h-3 w-3" /> Pending
      </Badge>
    );
  if (s === "rejected")
    return (
      <Badge variant="destructive">
        <ShieldAlert className="mr-1 h-3 w-3" /> Rejected
      </Badge>
    );
  return <Badge variant="outline">Unsubmitted</Badge>;
}

function AdminApprovalsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listKycSubmissions);
  const decideFn = useServerFn(setKycDecision);

  const [tab, setTab] = useState<KycStatus>("pending");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<KycProfile | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["kyc", "list", tab],
    queryFn: () =>
      listFn({ data: { status: tab } }) as Promise<KycProfile[]>,
  });

  const [onlyReferred, setOnlyReferred] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = rows;
    if (onlyReferred) out = out.filter((r) => !!r.referred_by_promoter_id);
    if (!term) return out;
    return out.filter(
      (r) =>
        (r.email ?? "").toLowerCase().includes(term) ||
        (r.full_name ?? "").toLowerCase().includes(term) ||
        (r.phone ?? "").toLowerCase().includes(term) ||
        (r.city ?? "").toLowerCase().includes(term) ||
        (r.referred_by_name ?? "").toLowerCase().includes(term) ||
        (r.referred_by_email ?? "").toLowerCase().includes(term) ||
        (r.aadhaar_number ?? "").includes(term),
    );
  }, [rows, q, onlyReferred]);

  const ALLOWED_ROLES = ["promoter", "customer"] as const;
  const TOAST_ID = "kyc-decision";
  const decideMut = useMutation({
    mutationFn: (v: {
      userId: string;
      approve: boolean;
      notes: string | null;
      assignRole?: "promoter" | "customer" | null;
    }) => {
      if (v.approve) {
        if (!v.assignRole) {
          throw new Error("Select a membership role (Customer or Promoter) before approving.");
        }
        if (!(ALLOWED_ROLES as readonly string[]).includes(v.assignRole)) {
          throw new Error(
            `"${v.assignRole}" is not an allowed membership role. Choose Customer or Promoter.`,
          );
        }
        const target = rows.find((r) => r.id === v.userId);
        if (target?.role === "admin") {
          throw new Error("This user is an admin — their role cannot be changed via KYC.");
        }
      } else if (v.assignRole) {
        throw new Error("A role can only be assigned when approving KYC.");
      }
      toast.loading(v.approve ? "Approving KYC…" : "Rejecting KYC…", { id: TOAST_ID });
      return decideFn({ data: v });
    },
    onSuccess: async (_r, v) => {
      const label = v.approve
        ? v.assignRole
          ? `Approved as ${v.assignRole}`
          : "KYC approved"
        : "KYC rejected";
      toast.success(label, {
        id: TOAST_ID,
        description: v.notes
          ? `Saved review notes: “${v.notes.length > 140 ? v.notes.slice(0, 140) + "…" : v.notes}”`
          : "No review notes were saved.",
      });
      try {
        await supabase.auth.refreshSession();
      } catch {
        // Non-fatal — cached role invalidation below will re-fetch anyway.
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["kyc"] }),
        qc.invalidateQueries({ queryKey: ["current-role"] }),
      ]);
      // Keep drawer open so the refetched row shows the updated status
      // and the saved review note in the "Previous review note" section.
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not update KYC decision", {
        id: TOAST_ID,
        description: "Fix the issue above and try again.",
      }),
  });


  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Membership approvals</h1>
        <p className="text-sm text-muted-foreground">
          Review customer and promoter KYC submissions and approve or reject membership.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as KycStatus)}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="unsubmitted">Not submitted</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button
            variant={onlyReferred ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyReferred((v) => !v)}
          >
            <UserRoundCog className="mr-1.5 h-3.5 w-3.5" />
            {onlyReferred ? "Referred by promoter" : "All submissions"}
          </Button>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name, email, phone, city, promoter, aadhaar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tab === "pending" && "Pending submissions"}
            {tab === "approved" && "Approved members"}
            {tab === "rejected" && "Rejected submissions"}
            {tab === "unsubmitted" && "Not yet submitted"} ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nothing here.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Referred by</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Aadhaar</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell>
                      <div className="font-medium">
                        {r.full_name || <span className="text-muted-foreground">—</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    </TableCell>
                    <TableCell>
                      {r.role ? (
                        <Badge variant="secondary" className="capitalize">
                          {r.role}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.referred_by_promoter_id ? (
                        <>
                          <div className="font-medium">
                            {r.referred_by_name || r.referred_by_email}
                          </div>
                          {r.referred_by_name && r.referred_by_email && (
                            <div className="text-muted-foreground">{r.referred_by_email}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Direct</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.phone || "—"}</TableCell>
                    <TableCell className="text-sm">{r.city || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.aadhaar_number ? "•••• •••• " + r.aadhaar_number.slice(-4) : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(r.kyc_status)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(r);
                        }}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ReviewDrawer
        row={selected ? rows.find((r) => r.id === selected.id) ?? selected : null}
        onClose={() => setSelected(null)}
        onDecide={(approve, notes, assignRole) =>
          selected &&
          decideMut.mutate({ userId: selected.id, approve, notes, assignRole })
        }
        pending={decideMut.isPending}
        pendingAction={
          decideMut.isPending
            ? decideMut.variables?.approve
              ? "approve"
              : "reject"
            : null
        }
      />
    </div>
  );
}

function ReviewDrawer({
  row,
  onClose,
  onDecide,
  pending,
}: {
  row: KycProfile | null;
  onClose: () => void;
  onDecide: (
    approve: boolean,
    notes: string | null,
    assignRole: "promoter" | "customer" | null,
  ) => void;
  pending: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [assignRole, setAssignRole] = useState<"promoter" | "customer">("customer");
  const signFn = useServerFn(getKycSignedUrl);
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  const [backUrl, setBackUrl] = useState<string | null>(null);

  useEffect(() => {
    setNotes(row?.kyc_review_notes ?? "");
    setAssignRole(row?.role === "promoter" ? "promoter" : "customer");
    setFrontUrl(null);
    setBackUrl(null);
    if (!row) return;
    (async () => {
      if (row.aadhaar_front_url) {
        try {
          const r = (await signFn({
            data: { path: row.aadhaar_front_url, forUserId: row.id },
          })) as { url: string };
          setFrontUrl(r.url);
        } catch {}
      }
      if (row.aadhaar_back_url) {
        try {
          const r = (await signFn({
            data: { path: row.aadhaar_back_url, forUserId: row.id },
          })) as { url: string };
          setBackUrl(r.url);
        } catch {}
      }
    })();
  }, [row?.id]);

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>
                {row.full_name || row.email}
                <span className="ml-2 align-middle">{statusBadge(row.kyc_status)}</span>
              </SheetTitle>
              <SheetDescription>Review the submitted details and decide.</SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              <Section title="Contact">
                <Row icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={row.email} mono />
                <Row icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={row.phone} mono />
              </Section>

              <Section title="Referring promoter">
                <ReferrerEditor row={row} />
              </Section>

              <Section title="Residential address">
                <Row
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  label="Address"
                  value={[row.address_line1, row.address_line2].filter(Boolean).join(", ")}
                />
                <Row label="City" value={row.city} />
                <Row label="State" value={row.state} />
                <Row label="Postal code" value={row.postal_code} />
                <Row label="Country" value={row.country} />
              </Section>

              <Section title="Aadhaar">
                <Row
                  icon={<IdCard className="h-3.5 w-3.5" />}
                  label="Number"
                  value={row.aadhaar_number}
                  mono
                />
                <Row label="Address on Aadhaar" value={row.aadhaar_address} />
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <Doc label="Front" url={frontUrl} hasFile={!!row.aadhaar_front_url} />
                  <Doc label="Back" url={backUrl} hasFile={!!row.aadhaar_back_url} />
                </div>
              </Section>

              {row.kyc_status !== "approved" && row.kyc_status !== "rejected" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Review notes (optional, shared with the user if rejected)</Label>
                    <Textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Aadhaar image is blurry, please re-upload"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Approve as</Label>
                    <Select
                      value={assignRole}
                      onValueChange={(v) => setAssignRole(v as "promoter" | "customer")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="promoter">Promoter</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Current role:{" "}
                      <span className="font-medium capitalize">{row.role ?? "—"}</span>
                      . Approving will assign the selected role
                      {row.role && row.role !== assignRole ? " (this changes their role)" : ""}.
                    </p>
                  </div>
                </>
              )}

              {(row.kyc_status === "approved" || row.kyc_status === "rejected") &&
                row.kyc_review_notes && (
                  <Section title="Previous review note">
                    <div className="text-sm text-muted-foreground">{row.kyc_review_notes}</div>
                  </Section>
                )}
            </div>

            <SheetFooter className="mt-6 gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              {row.kyc_status !== "rejected" && (
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() => onDecide(false, notes.trim() || null, null)}
                >
                  Reject
                </Button>
              )}
              {row.kyc_status !== "approved" && (
                <Button
                  disabled={pending}
                  onClick={() => onDecide(true, notes.trim() || null, assignRole)}
                >
                  Approve as {assignRole}
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="rounded-md border p-3 text-sm space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 w-32 shrink-0 text-xs text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </div>
      <div className={"min-w-0 flex-1 break-words " + (mono ? "font-mono text-xs" : "")}>
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function Doc({
  label,
  url,
  hasFile,
}: {
  label: string;
  url: string | null;
  hasFile: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="grid h-40 w-full place-items-center overflow-hidden rounded-md border bg-muted">
        {!hasFile ? (
          <span className="text-xs text-muted-foreground">Not uploaded</span>
        ) : !url ? (
          <span className="text-xs text-muted-foreground">Loading…</span>
        ) : url.match(/\.pdf($|\?)/i) ? (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <FileImage className="h-6 w-6" />
            <span className="text-xs">PDF document</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-contain" />
        )}
      </div>
      {url && (
        <Button size="sm" variant="ghost" asChild className="h-7 px-2 text-xs">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 h-3 w-3" /> Open full size
          </a>
        </Button>
      )}
    </div>
  );
}

function ReferrerEditor({ row }: { row: KycProfile }) {
  const qc = useQueryClient();
  const listPromotersFn = useServerFn(adminListPromoters);
  const setPromoterFn = useServerFn(adminSetCustomerPromoter);
  const [value, setValue] = useState<string>(row.referred_by_promoter_id ?? "none");

  useEffect(() => {
    setValue(row.referred_by_promoter_id ?? "none");
  }, [row.id, row.referred_by_promoter_id]);

  const promotersQ = useQuery({
    queryKey: ["admin-promoters-list"],
    queryFn: () => listPromotersFn() as Promise<PromoterOption[]>,
    staleTime: 5 * 60_000,
  });

  const saveMut = useMutation({
    mutationFn: (promoterId: string | null) =>
      setPromoterFn({ data: { userId: row.id, promoterId } } as any),
    onSuccess: () => {
      toast.success("Referring promoter updated");
      qc.invalidateQueries({ queryKey: ["kyc"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update"),
  });

  const currentLabel = row.referred_by_promoter_id
    ? row.referred_by_name || row.referred_by_email || row.referred_by_promoter_id.slice(0, 8)
    : "Direct signup";

  return (
    <div className="space-y-2">
      <Row
        icon={<UserRoundCog className="h-3.5 w-3.5" />}
        label="Current"
        value={currentLabel}
      />
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="h-9 flex-1">
            <SelectValue placeholder="Select promoter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Direct (no promoter)</SelectItem>
            {(promotersQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.full_name || p.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={
            saveMut.isPending ||
            value === (row.referred_by_promoter_id ?? "none")
          }
          onClick={() => saveMut.mutate(value === "none" ? null : value)}
        >
          {saveMut.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
