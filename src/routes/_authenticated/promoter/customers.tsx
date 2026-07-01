import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Users,
  UserPlus,
  Search,
  ShieldCheck,
  Clock,
  ShieldAlert,
  Copy,
  Lock,
  Send,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  listMyReferredCustomers,
  registerCustomerAsPromoter,
  submitReferralForReview,
  type ReferredCustomer,
} from "@/lib/promoter.functions";

export const Route = createFileRoute("/_authenticated/promoter/customers")({
  head: () => ({ meta: [{ title: "My Customers — Promoter" }] }),
  component: PromoterCustomersPage,
});

function kycBadge(s: ReferredCustomer["kyc_status"]) {
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

function PromoterCustomersPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyReferredCustomers);
  const registerFn = useServerFn(registerCustomerAsPromoter);

  const [q, setQ] = useState("");
  const [openRegister, setOpenRegister] = useState(false);
  const [selected, setSelected] = useState<ReferredCustomer | null>(null);
  const [issuedCreds, setIssuedCreds] = useState<{ email: string; password: string } | null>(null);

  const listQ = useQuery({
    queryKey: ["promoter-referred-customers"],
    queryFn: () => listFn(),
  });

  const filtered = useMemo(() => {
    const rows = listQ.data ?? [];
    if (!q.trim()) return rows;
    const s = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.full_name?.toLowerCase().includes(s) ||
        r.email?.toLowerCase().includes(s) ||
        r.phone?.toLowerCase().includes(s) ||
        r.city?.toLowerCase().includes(s) ||
        r.membership_number?.toLowerCase().includes(s),
    );
  }, [listQ.data, q]);

  const registerMut = useMutation({
    mutationFn: (input: Parameters<typeof registerFn>[0]) => registerFn(input),
    onSuccess: (res, vars) => {
      toast.success("Customer registered");
      if (res.temporary_password) {
        setIssuedCreds({ email: (vars as any).data.email, password: res.temporary_password });
      }
      setOpenRegister(false);
      qc.invalidateQueries({ queryKey: ["promoter-referred-customers"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to register customer"),
  });

  const rows = filtered;
  const total = listQ.data?.length ?? 0;
  const pending = (listQ.data ?? []).filter((r) => r.kyc_status === "pending").length;
  const approved = (listQ.data ?? []).filter((r) => r.kyc_status === "approved").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Customers</h1>
          <p className="text-sm text-muted-foreground">
            Customers you've referred. Aadhaar number and Aadhaar documents are hidden for
            privacy — admins handle KYC review.
          </p>
        </div>
        <Button onClick={() => setOpenRegister(true)} style={{ background: "var(--gradient-gold-value)" }}>
          <UserPlus className="mr-2 h-4 w-4" /> Register customer
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={<Users className="h-4 w-4" />} value={total} label="Total referred" />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          value={pending}
          label="Awaiting KYC review"
          tone="text-amber-500"
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          value={approved}
          label="Approved members"
          tone="text-emerald-500"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Referred customers</CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-64 pl-8"
              placeholder="Search name, email, phone, city…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {total === 0
                ? "You haven't referred any customers yet. Use 'Register customer' to add one."
                : "No customers match your search."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead>KYC</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.full_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          Joined {new Date(r.created_at).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.email ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.phone ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {[r.city, r.state].filter(Boolean).join(", ") || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.membership_number ? (
                          <div className="text-xs">
                            <div className="font-mono">{r.membership_number}</div>
                            <Badge variant="outline" className="mt-1 capitalize">
                              {r.membership_status ?? "pending"}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No plan yet</span>
                        )}
                      </TableCell>
                      <TableCell>{kycBadge(r.kyc_status)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelected(r)}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RegisterCustomerDialog
        open={openRegister}
        onClose={() => setOpenRegister(false)}
        submitting={registerMut.isPending}
        onSubmit={(payload) => registerMut.mutate({ data: payload } as any)}
      />

      <CustomerDetailSheet customer={selected} onClose={() => setSelected(null)} />

      <Dialog open={!!issuedCreds} onOpenChange={(o) => !o && setIssuedCreds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary credentials issued</DialogTitle>
            <DialogDescription>
              Share these securely with the customer. Ask them to sign in and change their
              password. This dialog is shown only once.
            </DialogDescription>
          </DialogHeader>
          {issuedCreds && (
            <div className="space-y-3 text-sm">
              <CopyRow label="Email" value={issuedCreds.email} />
              <CopyRow label="Temporary password" value={issuedCreds.password} mono />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIssuedCreds(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-full bg-primary/10 p-3 ${tone ?? "text-primary"}`}>{icon}</div>
        <div>
          <p className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span className={`flex-1 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.success(`${label} copied`);
            } catch {
              toast.error("Couldn't copy");
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RegisterCustomerDialog({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    email: string;
    full_name: string;
    phone: string | null;
    address_line1: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    send_invite: boolean;
  }) => void;
  submitting: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [addr, setAddr] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pin, setPin] = useState("");

  const reset = () => {
    setEmail("");
    setName("");
    setPhone("");
    setAddr("");
    setCity("");
    setState("");
    setPin("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register a new customer</DialogTitle>
          <DialogDescription>
            The customer will be linked to you as the referring promoter. They can complete KYC
            (Aadhaar upload) themselves after signing in.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Full name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
              />
            </div>
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
          </div>
          <div>
            <Label>Address</Label>
            <Input value={addr} onChange={(e) => setAddr(e.target.value)} maxLength={500} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} />
            </div>
            <div>
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} maxLength={80} />
            </div>
            <div>
              <Label>PIN</Label>
              <Input value={pin} onChange={(e) => setPin(e.target.value)} maxLength={12} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A temporary password will be generated and shown once for you to share.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={submitting || !email.trim() || !name.trim()}
            onClick={() =>
              onSubmit({
                email: email.trim(),
                full_name: name.trim(),
                phone: phone.trim() || null,
                address_line1: addr.trim() || null,
                city: city.trim() || null,
                state: state.trim() || null,
                postal_code: pin.trim() || null,
                send_invite: true,
              })
            }
          >
            {submitting ? "Creating…" : "Create customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetailSheet({
  customer,
  onClose,
}: {
  customer: ReferredCustomer | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        {customer && (
          <>
            <SheetHeader>
              <SheetTitle>{customer.full_name || customer.email}</SheetTitle>
              <SheetDescription>
                Full profile for your referred customer. Aadhaar identifiers are hidden.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-5 text-sm">
              <Section title="Contact">
                <Row label="Email" value={customer.email} />
                <Row label="Phone" value={customer.phone} />
              </Section>
              <Section title="Address">
                <Row label="Line 1" value={customer.address_line1} />
                <Row label="Line 2" value={customer.address_line2} />
                <Row
                  label="City / State"
                  value={[customer.city, customer.state].filter(Boolean).join(", ") || null}
                />
                <Row
                  label="Postal / Country"
                  value={
                    [customer.postal_code, customer.country].filter(Boolean).join(" · ") || null
                  }
                />
                <Row label="Aadhaar address (declared)" value={customer.aadhaar_address} />
              </Section>
              <Section title="Membership">
                <Row label="Number" value={customer.membership_number} mono />
                <Row label="ID No" value={customer.member_display_id} mono />
                <Row label="Coupon No" value={customer.coupon_no} mono />
                <Row label="Status" value={customer.membership_status} />
              </Section>
              <Section title="KYC">
                <div className="flex items-center gap-2">
                  {kycBadge(customer.kyc_status)}
                  <span className="text-xs text-muted-foreground">
                    {customer.kyc_submitted_at
                      ? `Submitted ${new Date(customer.kyc_submitted_at).toLocaleDateString()}`
                      : "Not submitted"}
                  </span>
                </div>
              </Section>
              <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          <Lock className="h-3.5 w-3.5" /> Aadhaar number & documents hidden
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Only the customer and admins can view Aadhaar identifiers and uploaded
                        images.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Promoters never see Aadhaar numbers or scans. Admins verify KYC.
                </p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5 rounded-md border border-border bg-card p-3">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-right ${mono ? "font-mono text-xs" : "text-sm"}`}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </span>
    </div>
  );
}
