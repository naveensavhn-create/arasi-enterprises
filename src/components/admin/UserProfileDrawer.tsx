import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Copy, ExternalLink, ShieldAlert } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  adminGetUserProfile,
  adminUpdateProfile,
  type AdminProfileDetail,
} from "@/lib/user-profile.functions";

type Props = {
  userId: string | null;
  onClose: () => void;
};

const FIELDS: Array<{ key: keyof FormState; label: string; type?: string; textarea?: boolean }> = [
  { key: "full_name", label: "Full name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "address_line1", label: "Address line 1" },
  { key: "address_line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country" },
];

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  aadhaar_number: string;
  aadhaar_address: string;
  reason: string;
};

function emptyForm(): FormState {
  return {
    full_name: "",
    email: "",
    phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
    aadhaar_number: "",
    aadhaar_address: "",
    reason: "",
  };
}

function fromProfile(p: AdminProfileDetail): FormState {
  return {
    full_name: p.full_name ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    address_line1: p.address_line1 ?? "",
    address_line2: p.address_line2 ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    postal_code: p.postal_code ?? "",
    country: p.country ?? "",
    aadhaar_number: p.aadhaar_number ?? "",
    aadhaar_address: p.aadhaar_address ?? "",
    reason: "",
  };
}

function CopyRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded border bg-muted/30 p-2">
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-mono text-sm">{value}</div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success("Copied");
          } catch {
            toast.error("Copy failed");
          }
        }}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function UserProfileDrawer({ userId, onClose }: Props) {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetUserProfile);
  const updateFn = useServerFn(adminUpdateProfile);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { data: profile, isLoading } = useQuery({
    queryKey: ["admin", "user-profile", userId],
    enabled: !!userId,
    queryFn: () => getFn({ data: { userId: userId as string } }) as Promise<AdminProfileDetail>,
  });

  useEffect(() => {
    if (profile) setForm(fromProfile(profile));
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateFn({ data: payload as any }),
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["admin", "user-profile", userId] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (form.reason.trim().length < 5)
      return toast.error("Enter a short reason (min 5 chars) for the audit log.");
    if (form.aadhaar_number && !/^[0-9]{12}$/.test(form.aadhaar_number))
      return toast.error("Aadhaar must be 12 digits.");
    saveMut.mutate({
      userId,
      full_name: form.full_name || null,
      email: form.email || null,
      phone: form.phone || null,
      address_line1: form.address_line1 || null,
      address_line2: form.address_line2 || null,
      city: form.city || null,
      state: form.state || null,
      postal_code: form.postal_code || null,
      country: form.country || null,
      aadhaar_number: form.aadhaar_number || null,
      aadhaar_address: form.aadhaar_address || null,
      reason: form.reason.trim(),
    });
  };

  const roleBadge = profile?.role ? (
    <Badge variant={profile.role === "admin" ? "default" : "secondary"} className="capitalize">
      {profile.role}
    </Badge>
  ) : null;

  return (
    <Sheet open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            User profile {roleBadge}
          </SheetTitle>
          <SheetDescription>
            Full profile with edit access. Changes are recorded in the admin audit log.
          </SheetDescription>
        </SheetHeader>

        {isLoading || !profile ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {profile.customer_display_id != null && (
                <CopyRow label="Customer ID" value={String(profile.customer_display_id)} />
              )}
              {profile.promoter_display_id && (
                <CopyRow label="Promoter ID" value={profile.promoter_display_id} />
              )}
              {profile.member_display_id && (
                <CopyRow label="Member ID" value={profile.member_display_id} />
              )}
              {profile.coupon_no && <CopyRow label="Coupon no." value={profile.coupon_no} />}
              {profile.membership_number && (
                <CopyRow label="Membership no." value={profile.membership_number} />
              )}
              {profile.promoter_referral_code && (
                <CopyRow label="Referral code" value={profile.promoter_referral_code} />
              )}
            </div>

            {profile.referred_by_promoter_id && (
              <div className="rounded border bg-muted/30 p-2 text-xs">
                <span className="text-muted-foreground">Referred by: </span>
                <span className="font-medium">{profile.referred_by_name ?? "—"}</span>
                {profile.referred_by_display_id && (
                  <span className="ml-1 text-muted-foreground">
                    ({profile.referred_by_display_id})
                  </span>
                )}
              </div>
            )}

            <Tabs defaultValue="edit">
              <TabsList>
                <TabsTrigger value="edit">Edit profile</TabsTrigger>
                <TabsTrigger value="aadhaar">Aadhaar / KYC</TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="mt-3">
                <form onSubmit={onSubmit} className="space-y-3">
                  {FIELDS.map((f) => (
                    <div key={f.key}>
                      <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                      <Input
                        id={`f-${f.key}`}
                        type={f.type ?? "text"}
                        value={form[f.key]}
                        onChange={set(f.key)}
                      />
                    </div>
                  ))}
                  <Separator />
                  <div>
                    <Label htmlFor="f-reason">
                      Reason for change <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="f-reason"
                      rows={2}
                      value={form.reason}
                      onChange={set("reason")}
                      placeholder="Corrected typo in customer's address (audit log entry)"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={saveMut.isPending}>
                      {saveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save changes
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="aadhaar" className="mt-3 space-y-3">
                <div className="flex items-start gap-2 rounded border border-amber-400/40 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    KYC status:{" "}
                    <span className="font-medium capitalize">{profile.kyc_status}</span>. Edits are
                    logged with an Aadhaar-edited flag in the audit log.
                  </div>
                </div>
                <div>
                  <Label htmlFor="f-aadhaar_number">Aadhaar number (12 digits)</Label>
                  <Input
                    id="f-aadhaar_number"
                    inputMode="numeric"
                    maxLength={12}
                    value={form.aadhaar_number}
                    onChange={set("aadhaar_number")}
                  />
                </div>
                <div>
                  <Label htmlFor="f-aadhaar_address">Aadhaar address</Label>
                  <Textarea
                    id="f-aadhaar_address"
                    rows={3}
                    value={form.aadhaar_address}
                    onChange={set("aadhaar_address")}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {profile.aadhaar_front_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={profile.aadhaar_front_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" /> Front image
                      </a>
                    </Button>
                  )}
                  {profile.aadhaar_back_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={profile.aadhaar_back_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" /> Back image
                      </a>
                    </Button>
                  )}
                </div>
                <div>
                  <Label htmlFor="f-reason2">Reason for change</Label>
                  <Textarea
                    id="f-reason2"
                    rows={2}
                    value={form.reason}
                    onChange={set("reason")}
                    placeholder="Why edit Aadhaar fields? (audit log)"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                  <Button
                    type="button"
                    onClick={onSubmit as any}
                    disabled={saveMut.isPending}
                  >
                    {saveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Aadhaar
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
